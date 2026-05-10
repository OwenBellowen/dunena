"""Type definitions for Dunena SDK responses."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CacheEntry:
    """A cache entry returned by GET operations."""
    key: str
    value: str


@dataclass
class StorageEntry:
    """A durable storage entry from the SQLite layer."""
    key: str
    value: str
    namespace: str = ""
    created_at: int = 0
    updated_at: int = 0
    expires_at: int | None = None
    tags: list[str] = field(default_factory=list)


@dataclass
class CacheStats:
    """Cache engine statistics."""
    hits: int = 0
    misses: int = 0
    evictions: int = 0
    puts: int = 0
    deletes: int = 0
    current_size: int = 0
    max_size: int = 0
    hit_rate: float = 0.0
    memory_bytes: int = 0
    cas_hits: int = 0
    cas_misses: int = 0


@dataclass
class HealthCheck:
    """Server health check response."""
    status: str
    version: str = ""
    uptime: float = 0.0
    timestamp: str = ""
    checks: dict[str, Any] = field(default_factory=dict)


@dataclass
class KeyScanResult:
    """Result of a key scan operation."""
    cursor: int = 0
    keys: list[str] = field(default_factory=list)


@dataclass
class StorageStats:
    """SQLite storage statistics."""
    backend: str = ""
    total_entries: int = 0
    total_namespaces: int = 0
    db_size_bytes: int = 0
