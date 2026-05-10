"""Synchronous Dunena client using httpx."""

from __future__ import annotations
from typing import Any
from urllib.parse import quote

import httpx

from dunena.exceptions import (
    DunenaError,
    ConnectionError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
)
from dunena.types import (
    CacheEntry,
    CacheStats,
    HealthCheck,
    KeyScanResult,
    StorageEntry,
    StorageStats,
)


class _DatabaseNamespace:
    """Sub-client for durable SQLite storage operations (db.get, db.set, etc.)."""

    def __init__(self, client: Dunena):
        self._client = client

    def get(self, key: str, *, ns: str = "") -> StorageEntry | None:
        """Get a durable storage entry."""
        params = {"ns": ns} if ns else {}
        try:
            data = self._client._request("GET", f"/db/{quote(key, safe='')}", params=params)
            return StorageEntry(
                key=data.get("key", key),
                value=data.get("value", ""),
                namespace=data.get("namespace", ""),
                created_at=data.get("createdAt", 0),
                updated_at=data.get("updatedAt", 0),
                expires_at=data.get("expiresAt"),
                tags=data.get("tags", []),
            )
        except NotFoundError:
            return None

    def set(
        self,
        key: str,
        value: str,
        *,
        ttl: int | None = None,
        ns: str = "",
        tags: list[str] | None = None,
    ) -> bool:
        """Store a durable entry."""
        body: dict[str, Any] = {"value": value}
        if ttl is not None:
            body["ttl"] = ttl
        if ns:
            body["ns"] = ns
        if tags:
            body["tags"] = tags
        data = self._client._request("POST", f"/db/{quote(key, safe='')}", json=body)
        return data.get("ok", False)

    def delete(self, key: str, *, ns: str = "") -> bool:
        """Delete a durable entry."""
        params = {"ns": ns} if ns else {}
        data = self._client._request("DELETE", f"/db/{quote(key, safe='')}", params=params)
        return data.get("deleted", False)

    def keys(self, pattern: str = "*", *, ns: str | None = None) -> list[str]:
        """List durable storage keys."""
        params: dict[str, str] = {"pattern": pattern}
        if ns:
            params["ns"] = ns
        data = self._client._request("GET", "/db-keys", params=params)
        return data.get("keys", [])

    def query(
        self,
        *,
        pattern: str | None = None,
        tags: list[str] | None = None,
        ns: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        order_by: str | None = None,
        order: str | None = None,
    ) -> list[StorageEntry]:
        """Query durable storage with filters."""
        body: dict[str, Any] = {"action": "query"}
        if pattern:
            body["pattern"] = pattern
        if tags:
            body["tags"] = tags
        if ns:
            body["ns"] = ns
        if limit is not None:
            body["limit"] = limit
        if offset is not None:
            body["offset"] = offset
        if order_by:
            body["orderBy"] = order_by
        if order:
            body["order"] = order
        data = self._client._request("POST", "/db", json=body)
        return [
            StorageEntry(
                key=e.get("key", ""),
                value=e.get("value", ""),
                namespace=e.get("namespace", ""),
                created_at=e.get("createdAt", 0),
                updated_at=e.get("updatedAt", 0),
                expires_at=e.get("expiresAt"),
                tags=e.get("tags", []),
            )
            for e in data.get("entries", [])
        ]

    def stats(self) -> StorageStats:
        """Get durable storage statistics."""
        data = self._client._request("GET", "/db-stats")
        return StorageStats(
            backend=data.get("backend", ""),
            total_entries=data.get("totalEntries", 0),
            total_namespaces=data.get("totalNamespaces", 0),
            db_size_bytes=data.get("dbSizeBytes", 0),
        )

    def clear(self, *, ns: str | None = None) -> None:
        """Clear all durable entries."""
        params = {"ns": ns} if ns else {}
        self._client._request("POST", "/db-clear", params=params)

    def purge(self) -> int:
        """Purge expired entries. Returns count of purged entries."""
        data = self._client._request("POST", "/db-purge")
        return data.get("purged", 0)


class Dunena:
    """Synchronous client for the Dunena cache engine.

    Usage:
        client = Dunena("http://localhost:3000")
        client.set("key", "value", ttl=60000)
        value = client.get("key")
        client.close()

    Context manager:
        with Dunena("http://localhost:3000") as client:
            client.set("key", "value")
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3000",
        *,
        token: str | None = None,
        timeout: float = 10.0,
    ):
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        self._client = httpx.Client(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
        )
        self.db = _DatabaseNamespace(self)

    def __enter__(self) -> Dunena:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP connection."""
        self._client.close()

    # ── Internal ─────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        try:
            resp = self._client.request(method, path, json=json, params=params)
        except httpx.ConnectError as e:
            raise ConnectionError(f"Cannot connect to Dunena: {e}") from e
        except httpx.TimeoutException as e:
            raise ConnectionError(f"Request timed out: {e}") from e

        if resp.status_code == 401 or resp.status_code == 403:
            raise AuthenticationError("Authentication failed", resp.status_code)
        if resp.status_code == 404:
            raise NotFoundError("Not found", 404)
        if resp.status_code == 400:
            data = resp.json() if resp.content else {}
            raise ValidationError(
                data.get("error", "Validation error"), 400
            )
        if resp.status_code >= 500:
            raise DunenaError(
                f"Server error ({resp.status_code})", resp.status_code
            )

        return resp.json() if resp.content else {}

    # ── Cache operations ─────────────────────────────────────

    def get(self, key: str, *, ns: str | None = None) -> str | None:
        """Get a cached value. Returns None if not found."""
        params = {"ns": ns} if ns else {}
        try:
            data = self._request("GET", f"/cache/{quote(key, safe='')}", params=params)
            return data.get("value")
        except NotFoundError:
            return None

    def set(
        self,
        key: str,
        value: str,
        *,
        ttl: int | None = None,
        ns: str | None = None,
    ) -> bool:
        """Set a cached value. Returns True on success."""
        body: dict[str, Any] = {"value": value}
        if ttl is not None:
            body["ttl"] = ttl
        if ns:
            body["ns"] = ns
        data = self._request("POST", f"/cache/{quote(key, safe='')}", json=body)
        return data.get("ok", False)

    def delete(self, key: str, *, ns: str | None = None) -> bool:
        """Delete a cached value. Returns True if deleted."""
        params = {"ns": ns} if ns else {}
        data = self._request("DELETE", f"/cache/{quote(key, safe='')}", params=params)
        return data.get("deleted", False)

    def mget(self, keys: list[str], *, ns: str | None = None) -> dict[str, str | None]:
        """Get multiple cached values at once."""
        body: dict[str, Any] = {"action": "mget", "keys": keys}
        if ns:
            body["ns"] = ns
        data = self._request("POST", "/cache", json=body)
        return data.get("result", {})

    def mset(
        self,
        entries: dict[str, str],
        *,
        ns: str | None = None,
    ) -> int:
        """Set multiple cached values. Returns count of entries stored."""
        body: dict[str, Any] = {
            "action": "mset",
            "entries": [{"key": k, "value": v} for k, v in entries.items()],
        }
        if ns:
            body["ns"] = ns
        data = self._request("POST", "/cache", json=body)
        return data.get("stored", 0)

    def keys(
        self,
        pattern: str = "*",
        *,
        ns: str | None = None,
        cursor: int = 0,
        count: int = 100,
    ) -> KeyScanResult:
        """Scan cache keys with glob pattern matching."""
        params: dict[str, str] = {
            "pattern": pattern,
            "cursor": str(cursor),
            "count": str(count),
        }
        if ns:
            params["ns"] = ns
        data = self._request("GET", "/keys", params=params)
        return KeyScanResult(
            cursor=data.get("cursor", 0),
            keys=data.get("keys", []),
        )

    # ── Management ───────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        """Get cache statistics and latency metrics."""
        return self._request("GET", "/stats")

    def flush(self) -> None:
        """Clear all cached data."""
        self._request("POST", "/flush")

    def health(self) -> HealthCheck:
        """Check server health."""
        data = self._request("GET", "/health")
        return HealthCheck(
            status=data.get("status", "unknown"),
            version=data.get("version", ""),
            uptime=data.get("uptime", 0.0),
            timestamp=data.get("timestamp", ""),
            checks=data.get("checks", {}),
        )

    def info(self) -> dict[str, Any]:
        """Get server information."""
        return self._request("GET", "/info")

    def snapshot(self) -> bool:
        """Trigger a snapshot save. Returns True on success."""
        data = self._request("POST", "/snapshot")
        return data.get("saved", False)
