# Contributing to Dunena

Thanks for your interest in contributing.

## Developer Quickstart

```bash
# 1. Clone and install
git clone https://github.com/PowenCu/dunena.git
cd dunena
bun install

# 2. Build the Zig shared library
bun run build:zig          # ReleaseSafe (production)
bun run build:zig:debug    # Debug mode (includes safety checks)

# 3. Run the full validation suite
bun run check              # TypeScript type-check
bun run test:all           # Zig unit tests + platform integration tests

# 4. Start the dev server
bun run dev                # http://localhost:3000 with file-watching
```

> **Tip:** After modifying any `.zig` file you must re-run `bun run build:zig`
> before running tests or starting the server — the TypeScript layer loads
> the compiled shared library at startup.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    Bun / TypeScript Runtime                       │
│  apps/server · apps/cli · packages/platform · packages/redis     │
├──────────────┬──────────────────┬────────────────────────────────┤
│  FFI Bridge  │ bun:sqlite (DB)  │  Cluster / HA                  │
│  ffi.ts      │ sqlite-adapter   │  membership · election         │
├──────────────┤                  │  auto-replication              │
│  Zig (.dll/  │ Durable KV with  ├────────────────────────────────┤
│   .so/.dylib)│ TTL, tags, ns    │  Observability                 │
│  LRU/LFU/ARC│                  │  OTEL · Prometheus · Analytics │
│  · Bloom·RLE │                  │                                │
└──────────────┴──────────────────┴────────────────────────────────┘
```

**Zig core** (`zig/src/`) compiles to a platform-native shared library via `zig build`. The TypeScript layer loads it through **Bun FFI** (`bun:ffi`), which provides zero-overhead calls into native code.

Key files in the FFI bridge:

| File | Role |
|------|------|
| `zig/src/exports.zig` | C-ABI exported functions (the contract) |
| `packages/platform/src/bridge/ffi.ts` | Bun `dlopen` bindings — must exactly match `exports.zig` |
| `packages/platform/src/bridge/cache-bridge.ts` | TypeScript wrappers with safe buffer management |

**Critical rule:** If you modify a function signature in `exports.zig`, you **must** update `ffi.ts` in the same commit to keep the ABI in sync.

## Monorepo Structure

| Directory | Purpose |
|-----------|---------|
| `apps/server/` | Deployable HTTP/WebSocket server entrypoint |
| `apps/cli/` | CLI tool for interacting with a running server |
| `packages/platform/` | Core platform logic: FFI bridge, services, DB, server, cluster, tests |
| `packages/platform/src/cluster/` | HA clustering: membership, election, orchestration |
| `packages/platform/src/server/graphql.ts` | GraphQL API handler (graphql-yoga) |
| `packages/platform/src/services/telemetry-service.ts` | OpenTelemetry integration |
| `packages/redis-adapter/` | RESP2 protocol translation layer — maps Redis commands to CacheService |
| `packages/dunena/` | Published npm CLI package (`bunx dunena`) |
| `sdks/python/` | Official Python SDK |
| `zig/` | Zig native engine: LRU/LFU/ARC cache, bloom filter, RLE compression, stats |
| `scripts/bench/` | k6 load testing suite |
| `deploy/` | Docker Compose, Kubernetes manifests, Terraform, Helm chart, env profiles |

## Skill Areas

If you're looking for what to work on, see `AGENT_SUGGESTIONS.md` for the full backlog. Major skill areas:

| Skill | Scope | Key files |
|-------|-------|-----------|
| `zig-core-engineering` | `zig/src/*` | `cache.zig`, `exports.zig`, `bloom_filter.zig` |
| `bun-platform-development` | `packages/platform/src/server/*` | `app.ts`, `middleware.ts`, `graphql.ts` |
| `sqlite-durable-storage` | `packages/platform/src/db/*` | `sqlite-adapter.ts`, `proxy.ts`, `query-cache.ts` |
| `cluster-ha` | `packages/platform/src/cluster/*` | `cluster-service.ts`, `membership.ts`, `election.ts` |
| `sdk-development` | `sdks/*`, `packages/dunena/*` | Python client, TypeScript CLI |
| `devops-infrastructure` | `deploy/*`, `scripts/*`, `.github/*` | CI/CD, Docker, k8s, Terraform |
| `testing-quality` | `packages/platform/tests/*` | `api.test.ts`, `db.test.ts`, `cache.test.ts` |

## Common Development Pitfalls

1. **Forgetting to rebuild Zig** — The native library is not rebuilt automatically. Always run `bun run build:zig` after Zig changes.
2. **ABI mismatch** — If `ffi.ts` and `exports.zig` disagree on argument types, you'll get segfaults or garbled data. Double-check both files.
3. **Shared library path** — `ffi.ts` looks for the library in `zig/zig-out/lib/` and `zig/zig-out/bin/`. The file extension varies by platform (`.dll` / `.so` / `.dylib`).
4. **Memory ownership** — Zig owns all allocations inside the native core. The TypeScript side must not free native memory. Use the `destroy()` methods.
5. **Cross-package imports** — Use the main entry point (`@dunena/platform`) when importing types across workspace packages. Do not import from internal `src/` paths directly. See ADR-001 in `AGENT_SUGGESTIONS.md`.
6. **Namespace separator** — Cache keys use `\0` as a namespace separator. Any new feature that creates composite keys must use this convention. See ADR-003.
7. **AppConfig changes** — When adding new config sections, update: `types/index.ts`, `utils/config.ts`, `.env.example`, _and_ the test configs in `tests/api.test.ts` and `tests/db.test.ts`.

## Pull request guidelines

1. Open an issue first for large changes.
2. Keep PRs focused and small.
3. Add/adjust tests for behavioral changes.
4. Keep public APIs backward-compatible when possible.
5. Ensure CI passes (`bun run check && bun run test:all`).
6. Update `CHANGELOG.md` with user-visible changes.

## Commit and release notes

- Use clear, imperative commit messages.
- Mention user-visible changes in PR description.
- Follow [Keep a Changelog](https://keepachangelog.com/) format.

## Reporting bugs

When reporting a bug, include:

- Dunena version (`bunx dunena version`)
- Bun and Zig versions
- OS and architecture
- Reproduction steps
- Expected vs actual behavior
- Relevant logs (set `DUNENA_LOG_LEVEL=debug` for verbose output)

## Security

Please do not disclose vulnerabilities publicly before triage.
See `SECURITY.md`.
