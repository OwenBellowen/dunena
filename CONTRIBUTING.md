# Contributing to Dunena

Thanks for your interest in contributing.

## Developer Quickstart

```bash
# 1. Clone and install
git clone https://github.com/OwenBellowen/dunena.git
cd dunena
bun install

# 2. Build the Zig shared library
bun run build:zig          # ReleaseFast (production)
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
┌──────────────────────────────────────────┐
│        Bun / TypeScript Runtime          │
│  apps/server · apps/cli · packages/plat  │
├──────────────┬───────────────────────────┤
│  FFI Bridge  │   bun:sqlite (Database)   │
│  ffi.ts      │   sqlite-adapter.ts       │
├──────────────┤                           │
│  Zig (.dll / │   Durable KV store with   │
│   .so/.dylib)│   TTL, tags, namespaces   │
│  LRU · Bloom │                           │
│  · RLE · Stat│                           │
└──────────────┴───────────────────────────┘
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
| `packages/platform/` | Core platform logic: FFI bridge, services, DB, server, tests |
| `zig/` | Zig native engine: LRU cache, bloom filter, RLE compression, stats |
| `deploy/` | Docker Compose, Kubernetes manifests, env profiles |

## Common Development Pitfalls

1. **Forgetting to rebuild Zig** — The native library is not rebuilt automatically. Always run `bun run build:zig` after Zig changes.
2. **ABI mismatch** — If `ffi.ts` and `exports.zig` disagree on argument types, you'll get segfaults or garbled data. Double-check both files.
3. **Shared library path** — `ffi.ts` looks for the library in `zig/zig-out/lib/` and `zig/zig-out/bin/`. The file extension varies by platform (`.dll` / `.so` / `.dylib`).
4. **Memory ownership** — Zig owns all allocations inside the native core. The TypeScript side must not free native memory. Use the `destroy()` methods.

## Pull request guidelines

1. Open an issue first for large changes.
2. Keep PRs focused and small.
3. Add/adjust tests for behavioral changes.
4. Keep public APIs backward-compatible when possible.
5. Ensure CI passes.

## Commit and release notes

- Use clear, imperative commit messages.
- Mention user-visible changes in PR description.

## Reporting bugs

When reporting a bug, include:

- Dunena version
- Bun and Zig versions
- OS and architecture
- Reproduction steps
- Expected vs actual behavior
- Relevant logs

## Security

Please do not disclose vulnerabilities publicly before triage.
See `SECURITY.md`.
