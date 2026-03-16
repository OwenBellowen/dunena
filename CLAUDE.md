# Dunena Project Context & Agent Guidelines

## 🏗️ Architecture & Tech Stack
- **Monorepo Manager:** Bun (Workspaces)
- **Primary Language:** TypeScript (Strict mode)
- **High-Performance Core:** Zig (0.11.0+)
- **Database:** SQLite
- **Deployment:** Docker & Kubernetes (K8s)

### Directory Structure
- `/apps/cli/`: Command-line interface tool (TypeScript).
- `/apps/server/`: Main application server (TypeScript).
- `/packages/platform/`: Core platform logic handling DB, Cache, PubSub, WebSockets, and the Zig FFI bridge.
- `/zig/`: High-performance modules (Bloom Filter, Cache, Compression, Stats) compiled to shared libraries for FFI.
- `/deploy/`: Docker Compose and Kubernetes manifests.

## 🚀 Build & Run Commands
- **Install dependencies:** `bun install`
- **Build Zig modules:** `cd zig && zig build`
- **Run tests (Platform):** `cd packages/platform && bun test`

## 🧠 Coding Conventions & Rules

### TypeScript / Bun
- Use modern TypeScript syntax and strict type checking.
- Prefer Bun's native APIs (`Bun.serve`, `Bun.file`, etc.) over standard Node.js polyfills where possible.
- Ensure proper error boundaries and logging using the `packages/platform/src/utils/logger.ts`.

### Zig & FFI Bridge
- **CRITICAL:** The TypeScript FFI definitions in `/packages/platform/src/bridge/ffi.ts` must exactly match the exported C-ABI functions in `/zig/src/exports.zig`.
- If you modify a function signature in Zig, you MUST update the corresponding TypeScript FFI bridge in the same prompt.
- Manage memory explicitly in Zig. Ensure allocations passed across the FFI boundary are properly freed to prevent memory leaks.

### Database (SQLite)
- Use the adapter pattern established in `/packages/platform/src/db/sqlite-adapter.ts`.
- Always implement query caching where appropriate, utilizing the Zig-backed cache bridge (`cache-bridge.ts`).

## 🛡️ Safety Guardrails
1. **Never** modify the `.env.prod` or Kubernetes production secrets in `/deploy/k8s/` without explicit permission.
2. Run relevant tests before proposing a complex refactor, especially crossing the TS/Zig boundary.
3. Do not introduce new heavy npm dependencies if Bun or Zig provides a native, performant alternative.
4. Do note that I will ask you to push to Github ONCE I have check and approved everything.