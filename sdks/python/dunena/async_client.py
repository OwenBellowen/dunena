"""Asynchronous Dunena client using httpx.AsyncClient."""

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
from dunena.types import HealthCheck, KeyScanResult, StorageEntry, StorageStats


class _AsyncDatabaseNamespace:
    """Async sub-client for durable SQLite storage operations."""

    def __init__(self, client: AsyncDunena):
        self._client = client

    async def get(self, key: str, *, ns: str = "") -> StorageEntry | None:
        params = {"ns": ns} if ns else {}
        try:
            data = await self._client._request("GET", f"/db/{quote(key, safe='')}", params=params)
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

    async def set(
        self, key: str, value: str, *, ttl: int | None = None, ns: str = "", tags: list[str] | None = None
    ) -> bool:
        body: dict[str, Any] = {"value": value}
        if ttl is not None:
            body["ttl"] = ttl
        if ns:
            body["ns"] = ns
        if tags:
            body["tags"] = tags
        data = await self._client._request("POST", f"/db/{quote(key, safe='')}", json=body)
        return data.get("ok", False)

    async def delete(self, key: str, *, ns: str = "") -> bool:
        params = {"ns": ns} if ns else {}
        data = await self._client._request("DELETE", f"/db/{quote(key, safe='')}", params=params)
        return data.get("deleted", False)

    async def keys(self, pattern: str = "*", *, ns: str | None = None) -> list[str]:
        params: dict[str, str] = {"pattern": pattern}
        if ns:
            params["ns"] = ns
        data = await self._client._request("GET", "/db-keys", params=params)
        return data.get("keys", [])

    async def query(
        self,
        *,
        pattern: str | None = None,
        tags: list[str] | None = None,
        ns: str | None = None,
        limit: int | None = None,
    ) -> list[StorageEntry]:
        body: dict[str, Any] = {"action": "query"}
        if pattern:
            body["pattern"] = pattern
        if tags:
            body["tags"] = tags
        if ns:
            body["ns"] = ns
        if limit is not None:
            body["limit"] = limit
        data = await self._client._request("POST", "/db", json=body)
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

    async def stats(self) -> StorageStats:
        data = await self._client._request("GET", "/db-stats")
        return StorageStats(
            backend=data.get("backend", ""),
            total_entries=data.get("totalEntries", 0),
            total_namespaces=data.get("totalNamespaces", 0),
            db_size_bytes=data.get("dbSizeBytes", 0),
        )

    async def clear(self, *, ns: str | None = None) -> None:
        params = {"ns": ns} if ns else {}
        await self._client._request("POST", "/db-clear", params=params)

    async def purge(self) -> int:
        data = await self._client._request("POST", "/db-purge")
        return data.get("purged", 0)


class AsyncDunena:
    """Asynchronous client for the Dunena cache engine.

    Usage:
        async with AsyncDunena("http://localhost:3000") as client:
            await client.set("key", "value")
            value = await client.get("key")
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

        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
        )
        self.db = _AsyncDatabaseNamespace(self)

    async def __aenter__(self) -> AsyncDunena:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    # ── Internal ─────────────────────────────────────────────

    async def _request(
        self, method: str, path: str, *, json: Any = None, params: dict[str, str] | None = None
    ) -> dict[str, Any]:
        try:
            resp = await self._client.request(method, path, json=json, params=params)
        except httpx.ConnectError as e:
            raise ConnectionError(f"Cannot connect to Dunena: {e}") from e
        except httpx.TimeoutException as e:
            raise ConnectionError(f"Request timed out: {e}") from e

        if resp.status_code in (401, 403):
            raise AuthenticationError("Authentication failed", resp.status_code)
        if resp.status_code == 404:
            raise NotFoundError("Not found", 404)
        if resp.status_code == 400:
            data = resp.json() if resp.content else {}
            raise ValidationError(data.get("error", "Validation error"), 400)
        if resp.status_code >= 500:
            raise DunenaError(f"Server error ({resp.status_code})", resp.status_code)

        return resp.json() if resp.content else {}

    # ── Cache operations ─────────────────────────────────────

    async def get(self, key: str, *, ns: str | None = None) -> str | None:
        params = {"ns": ns} if ns else {}
        try:
            data = await self._request("GET", f"/cache/{quote(key, safe='')}", params=params)
            return data.get("value")
        except NotFoundError:
            return None

    async def set(self, key: str, value: str, *, ttl: int | None = None, ns: str | None = None) -> bool:
        body: dict[str, Any] = {"value": value}
        if ttl is not None:
            body["ttl"] = ttl
        if ns:
            body["ns"] = ns
        data = await self._request("POST", f"/cache/{quote(key, safe='')}", json=body)
        return data.get("ok", False)

    async def delete(self, key: str, *, ns: str | None = None) -> bool:
        params = {"ns": ns} if ns else {}
        data = await self._request("DELETE", f"/cache/{quote(key, safe='')}", params=params)
        return data.get("deleted", False)

    async def mget(self, keys: list[str], *, ns: str | None = None) -> dict[str, str | None]:
        body: dict[str, Any] = {"action": "mget", "keys": keys}
        if ns:
            body["ns"] = ns
        data = await self._request("POST", "/cache", json=body)
        return data.get("result", {})

    async def mset(self, entries: dict[str, str], *, ns: str | None = None) -> int:
        body: dict[str, Any] = {
            "action": "mset",
            "entries": [{"key": k, "value": v} for k, v in entries.items()],
        }
        if ns:
            body["ns"] = ns
        data = await self._request("POST", "/cache", json=body)
        return data.get("stored", 0)

    async def keys(
        self, pattern: str = "*", *, ns: str | None = None, cursor: int = 0, count: int = 100
    ) -> KeyScanResult:
        params: dict[str, str] = {"pattern": pattern, "cursor": str(cursor), "count": str(count)}
        if ns:
            params["ns"] = ns
        data = await self._request("GET", "/keys", params=params)
        return KeyScanResult(cursor=data.get("cursor", 0), keys=data.get("keys", []))

    # ── Management ───────────────────────────────────────────

    async def stats(self) -> dict[str, Any]:
        return await self._request("GET", "/stats")

    async def flush(self) -> None:
        await self._request("POST", "/flush")

    async def health(self) -> HealthCheck:
        data = await self._request("GET", "/health")
        return HealthCheck(
            status=data.get("status", "unknown"),
            version=data.get("version", ""),
            uptime=data.get("uptime", 0.0),
            timestamp=data.get("timestamp", ""),
            checks=data.get("checks", {}),
        )

    async def info(self) -> dict[str, Any]:
        return await self._request("GET", "/info")

    async def snapshot(self) -> bool:
        data = await self._request("POST", "/snapshot")
        return data.get("saved", False)
