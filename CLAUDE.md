# Dunena — Agent & Developer Context

## Architecture at a glance

Dunena is a monorepo with two deployable apps and one core platform package:

```
dunena/
├── apps/
│   ├── server/          # Bun HTTP server (thin entrypoint → @dunena/platform)
│   └── cli/             # Monorepo CLI entrypoint (thin wrapper → @dunena/platform/cli)
├── packages/
│   ├── platform/        # ALL core logic: FFI bridge, HTTP app, DB, services, tests
│   └── dunena/          # Published npm package: standalone CLI for end-users (bunx dunena)
├── zig/                 # Zig native core compiled to shared library via FFI
├── deploy/              # Docker Compose + Kubernetes manifests + env profiles
└── scripts/             # Version bump, changelog, release, clean
```

### Tech stack
- **Runtime**: Bun ≥ 1.0 (Workspaces, native SQLite, FFI, serve)
- **Language**: TypeScript (strict mode), Zig ≥ 0.15.2
- **Database**: SQLite via `bun:sqlite` (zero external deps)
- **Native bridge**: Bun FFI (`bun:ffi`) calling into `zig/zig-out/lib/libdunena.{so,dll,dylib}`
- **Deployment**: Docker (single-replica), Kubernetes (single-replica, `Recreate` strategy)

---

## The FFI boundary — read this first

This is the highest-risk surface in the codebase. Two files must always be in sync:

| File | Role |
|------|------|
| `zig/src/exports.zig` | C-ABI exported functions — the ground truth |
| `packages/platform/src/bridge/ffi.ts` | Bun `dlopen` bindings — must mirror exports.zig exactly |

**ABI contract:**
- Handles are `usize` (opaque pointer). Non-zero = valid. Zero = allocation failed.
- Return codes: `0` = success, `-1` = error/not-found, `-2` = buffer too small (cache_get only), positive `i32` = bytes written.
- Buffer ownership: Zig owns all memory inside the native core. TypeScript must never free native memory. Use `destroy()` methods.
- `encodeSafe()` in `cache-bridge.ts` exists because Bun's `ptr()` panics on zero-length `Uint8Array`. Never bypass it.

**If you change a function signature in `exports.zig`, you MUST update `ffi.ts` in the same commit.**

---

## Build commands

```bash
bun install                              # install all workspace deps
bun run build:zig                        # compile Zig → ReleaseSafe (production/CI)
bun run build:zig:debug                  # compile Zig → Debug (safety checks + symbols)
bun run build:zig:fast                   # compile Zig → ReleaseFast (benchmarks only)
bun run start                            # start the server
bun run dev                              # start with file watching
bun run cli -- <cmd>                     # run CLI against a running server
bun run test                             # TypeScript tests (platform package)
bun run test:zig                         # Zig unit tests
bun run test:all                         # build:zig + test:zig + test
bun run check                            # tsc --noEmit
```

After modifying any `.zig` file, you must re-run `bun run build:zig` before tests or server start — the TypeScript layer loads the compiled `.so`/`.dll`/`.dylib` at startup, not source files.

---

## Known issues and active constraints

### `keySet` eviction drift (critical bug)
`packages/platform/src/services/cache-service.ts` maintains a TypeScript-side `keySet: Set<string>` to track all keys for the `keys()` scan operation. When the native Zig LRU evicts an entry at capacity, `keySet` is **not updated** — there is no eviction callback across the FFI boundary. This means `cacheService.keys()` returns ghost keys that no longer exist. `exportEntries()` already handles the null case, but `keys()` output is stale.

Until a fix is in place, do not rely on `/keys` scan results for exact correctness under load near `maxEntries`. A fix requires either (a) exposing an eviction callback from Zig, (b) tracking eviction order in TypeScript alongside the native cache, or (c) calling `cache.has()` on each key in `keys()` (expensive).

### `btoa`/`atob` compression encoding
`cache-service.ts` uses `String.fromCharCode(...compressed)` + `btoa` for compression encoding. Spreading a large `Uint8Array` this way will stack-overflow beyond ~100K bytes. Use `Buffer.from(compressed).toString('base64')` and `Buffer.from(encoded, 'base64')` instead.

### SQLite is single-writer
SQLite is not safe for multiple concurrent writers. The Kubernetes manifest enforces `replicas: 1` and `strategy: Recreate`. **Never increase replicas** unless you replace SQLite with a networked database. The PVC uses `ReadWriteOnce` but that only prevents multi-node mounting — it does not prevent two pods on the same node from writing simultaneously.

### Dockerfile is missing Zig installation
The `apps/server/Dockerfile` runs `zig build` but does not install Zig. Any Docker build will fail with `command not found`. Add a Zig installation step before the build stage (download the 0.15.2 Linux x86_64 tarball from ziglang.org, extract, symlink to `/usr/local/bin/zig`).

### Version drift
Several files hardcode version strings instead of reading from `package.json`:
- `packages/dunena/src/cli.ts`: `const VERSION = "0.2.1"` — should be `0.3.1`
- `packages/platform/src/server/app.ts`: `version: "0.2.0"` — should be `0.3.1`
- All docs HTML footers: `v0.2.0`
- `openapi.yaml`: `version: "0.2.0"`

When running `bun run version:bump`, ensure these are also updated or wired to a shared constant.

### npm CLI missing commands
`packages/dunena/src/cli.ts` documents `flush`, `history`, and `info` in its help text but has no `case` branches for them. Users running `bunx dunena flush` will see the help output instead of an error. Add the missing cases or remove them from the help text.

---

## Coding conventions

### TypeScript / Bun
- Prefer Bun-native APIs (`Bun.serve`, `Bun.file`, `Bun.spawnSync`) over Node.js equivalents.
- Log using `logger.child("subsystem")` from `packages/platform/src/utils/logger.ts` — never `console.log` in production paths.
- All validation goes through `packages/platform/src/utils/validation.ts`. Add helpers there, not inline in handlers.
- The app entrypoint is `packages/platform/src/server/app.ts → createApp()`. Route handlers live inline in that file for now; extract to dedicated files only when a handler group exceeds ~150 lines.

### Zig
- Production builds use `ReleaseSafe` (bounds checks + overflow traps). Only `ReleaseFast` for benchmarking.
- Manage memory explicitly. All allocations inside `zig/src/` are owned by Zig. Do not pass Zig-owned pointers back to TypeScript for freeing.
- The public C-ABI surface is `zig/src/exports.zig` only. Internal modules (`cache.zig`, `bloom_filter.zig`, `compression.zig`, `stats.zig`) are imported by `exports.zig` and are not independently linked.

### Database
- Use `SQLiteAdapter` from `packages/platform/src/db/sqlite-adapter.ts` for all durable storage. Do not write raw SQL elsewhere.
- Query caching goes through `QueryCacheService`. The namespace `__qcache__` is reserved.
- The DB proxy (`/db-proxy/*`) is admin/internal only. Never log `connectionString` values.

---

## Services overview

| Service | File | Responsibility |
|---------|------|----------------|
| `CacheService` | `services/cache-service.ts` | TTL, namespaces, bloom filter, compression, key tracking |
| `AnalyticsService` | `services/analytics-service.ts` | Latency recording, snapshot history, Prometheus data |
| `PubSubService` | `services/pubsub-service.ts` | In-process event bus (cache mutations → WS broadcast) |
| `PersistenceService` | `services/persistence-service.ts` | JSON snapshot save/restore, auto-save interval |
| `SQLiteAdapter` | `db/sqlite-adapter.ts` | Durable KV with tags, TTL, batch, query |
| `QueryCacheService` | `db/query-cache.ts` | Two-level cache (Zig L1 + SQLite L2) for query results |
| `DatabaseProxy` | `db/proxy.ts` | External DB connector registry + cache-aside queries |

---

## Test structure

```
packages/platform/tests/
├── api.test.ts          # HTTP integration tests (spins up real server on port 19876)
├── cache.test.ts        # Unit tests for FFI bridge layer (NativeCache, bloom, stats, compression)
├── db.test.ts           # Database integration tests (SQLite, query cache, proxy — port 19877)
└── ffi-boundary.test.ts # Edge cases at the Zig↔TS boundary (empty strings, destroy cycles, etc.)
```

Each integration test suite starts its own server with an in-memory SQLite config. Tests do not share state between files. Use `bun run test:all` to run the full suite including Zig unit tests.

---

## Environment variables (key ones)

| Variable | Default | Notes |
|----------|---------|-------|
| `DUNENA_PORT` | `3000` | HTTP port |
| `DUNENA_HOST` | `127.0.0.1` | Use `0.0.0.0` in Docker/K8s |
| `DUNENA_MAX_ENTRIES` | `100000` | Native cache capacity |
| `DUNENA_AUTH_TOKEN` | unset | Auth disabled if unset |
| `DUNENA_DB_PATH` | `./data/dunena.db` | Use `:memory:` for tests |
| `DUNENA_BLOOM_FILTER` | `true` | Disable to reduce memory |
| `DUNENA_LOG_LEVEL` | `info` | `debug/info/warn/error` |
| `DUNENA_LOG_FORMAT` | `text` | Use `json` in staging/prod |

Full reference in `README.md#configuration`.

---

## Safety rules

1. **Never** modify `.env.prod` or Kubernetes secrets in `deploy/k8s/` without explicit permission.
2. **Never** set Kubernetes `replicas` > 1 for SQLite-backed deployments.
3. **Never** use `ReleaseFast` in production or CI — only `ReleaseSafe`.
4. **Never** introduce npm dependencies that Bun or Zig already covers natively.
5. Run `bun run test:all` and `bun run check` before proposing any refactor that touches the FFI boundary.
6. Git pushes happen only after the human has reviewed and approved. Do not `git push` autonomously.
7. The DB proxy connection strings may contain credentials. Never log them, never include them in error responses.