# Copilot Instructions for Dunena

## Build, test, and lint commands

```bash
# Install workspace deps
bun install

# Build Zig native library (required for server runtime + Bun tests that touch FFI)
bun run build:zig

# Alternative Zig build modes
bun run build:zig:fast
bun run build:zig:debug

# Type-check (this is the CI "lint" gate)
bun run check

# Tests
bun run test:all        # Zig tests + platform tests
bun run test:zig        # Zig tests only
bun run test            # Bun tests in packages/platform

# Run one Bun test file
bun test packages/platform/tests/db.test.ts

# Run one Bun test case by name
bun test packages/platform/tests/cache.test.ts --test-name-pattern "LRU eviction"

# Run one Zig test by name
zig test zig/src/exports.zig --test-filter "cache basic operations"
```

If you change any file under `zig/src/`, rebuild with `bun run build:zig` before running server/tests.

## High-level architecture

- This is a Bun + TypeScript monorepo with a Zig native core:
  - `apps/server` and `apps/cli` are thin entrypoints.
  - `packages/platform` contains almost all runtime logic.
  - `zig/src` contains the native cache/bloom/compression/stats engine exported via C-ABI.
- `packages/platform/src/server/app.ts` is the composition root:
  - wires `CacheService`, `AnalyticsService`, `PersistenceService`, optional `SQLiteAdapter`, `QueryCacheService`, `DatabaseProxy`, `LockService`, and `ReplicationService`.
  - exposes HTTP routes, WebSocket handlers, docs/dashboard static serving, metrics, and graceful shutdown.
- Native boundary:
  - Zig exports in `zig/src/exports.zig`.
  - Bun FFI bindings in `packages/platform/src/bridge/ffi.ts`.
  - Type-safe wrappers in `packages/platform/src/bridge/cache-bridge.ts`.
- Data path is intentionally layered:
  - L1 cache: in-memory Zig cache (`CacheService`).
  - L2 cache/storage: SQLite (`SQLiteAdapter`), including query cache and tag invalidation.
  - Query cache uses namespace `__qcache__` and promotes L2 hits back into L1.

## Key repository conventions

- **ABI lockstep is mandatory:** any signature change in `zig/src/exports.zig` must be mirrored in `packages/platform/src/bridge/ffi.ts` in the same change.
- **Namespace behavior differs by layer (intentionally):**
  - in-memory cache keys are composed as `${namespace}\0${key}`.
  - SQLite stores `namespace` in its own column (default empty string).
  - API/CLI namespace input uses `ns` query/body fields.
- **Route validation pattern is consistent:** handlers validate with `validateKey`, `validateValue`, and `validateTTL`, then return `validationError(...)` for 400s.
- **Route declaration order matters:** define fixed paths before parameterized ones (example: `/query-cache/stats` before `/query-cache/:key`).
- **WebSocket event flow uses Pub/Sub bridge:** cache mutations publish to `PubSubService`, then `app.ts` forwards `"cache"` channel messages to Bun WS topic `"cache-events"`.
- **Lifecycle cleanup is explicit:** timers, persistence, SQLite adapter, and native cache are all shut down in `createApp`'s shutdown handler; follow this pattern when adding long-lived resources.
