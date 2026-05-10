# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-03-28

### Added

- **Memory Usage Tracking**: Track actual memory usage (bytes) per cache entry in Zig core, exposed via `/stats` and `/metrics` endpoints
- **Atomic Increment/Decrement**: `INCR` and `DECR` operations for numeric counters via `/cache/:key/incr` and `/cache/:key/decr` endpoints
- **Compare-and-Swap (CAS)**: Optimistic locking with version tracking via `/cache/:key/version` and `/cache/:key/cas` endpoints
- **TTL Touch/Update API**: Update TTL without re-setting value via `/cache/:key/touch` endpoint, get remaining TTL via `/cache/:key/ttl`
- **LRU/LFU Switchable Eviction**: Support for both LRU (Least Recently Used) and LFU (Least Frequently Used) eviction policies, configurable at cache creation
- **Key Expiration Events**: WebSocket clients receive `expired` events when keys expire (via PubSub)
- **Cache Warmup API**: Bulk import endpoint `POST /cache/warmup` to pre-populate cache from JSON
- **Distributed Locking**: Lock service with acquire/release/extend operations via `/locks` endpoints
- **Cache Replication**: Write-through replication to secondary cache instances with async/sync modes via `/replication` endpoints
- **Cache Info Endpoint**: `GET /cache/info` returns eviction policy, memory usage, and CAS statistics
- CLI commands: `incr`, `decr`, `version`, `cas`, `ttl`, `touch`, `cache-info`, `warmup`, `lock-*`, `replication-*`
- New Prometheus metrics: `dunena_cache_memory_bytes`, `dunena_cache_cas_hits_total`, `dunena_cache_cas_misses_total`, `dunena_locks_active`

### Changed

- `CacheStats` now includes `memoryBytes`, `casHits`, and `casMisses` fields
- `CacheConfig` now accepts optional `evictionPolicy` field (`"lru"` or `"lfu"`)
- Zig `CacheEntry` struct now includes `version` and `access_count` fields
- FFI stats buffer increased from 7 to 10 u64 values

## [0.3.1] - 2026-03-17

## [0.3.0] - 2026-03-17

## [0.2.0] - 2026-03-16

### Added

- FFI boundary tests for edge cases (empty keys, oversized values, create/destroy cycles)
- ABI-safety docstrings in `exports.zig` and `ffi.ts`
- Zero-length input guards in Zig exports (bloom filter, stats)
- CI dependency caching for Zig build artifacts
- Separate lint job in CI for faster feedback
- `CHANGELOG.md` scaffold
- `CODEOWNERS` file
- Expanded `CONTRIBUTING.md` with developer quickstart and architecture overview

### Changed

- Unified Zig setup action across CI and release workflows (`mlugg/setup-zig@v2.2.1`)
- Improved `.gitignore` patterns
- Improved FFI bridge safety in `cache-bridge.ts` to handle zero-length strings gracefully (Bun FFI compatibility)

### Fixed

- Potential undefined behavior in stats exports when called with zero-length data
- TypeError in Bun FFI when passing empty ArrayBufferView to `ptr()`
