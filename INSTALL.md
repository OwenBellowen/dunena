# Installing & Running Dunena

Choose the installation method that fits your use case.

## Installation Methods

| Method | Best For | Prerequisites | Native Build? |
|--------|----------|---------------|---------------|
| [Docker](#docker-quickstart) | Quick trial, deployment | Docker | No |
| [GitHub Release](#github-release) | Standalone server | Bun | No |
| [Source Build](#build-from-source) | Contributors, development | Bun + Zig | Yes |
| [Kubernetes](#kubernetes) | Production deployment | kubectl + Docker | No |

> **Note:** Dunena requires a platform-native shared library (Zig → `.dll`/`.so`/`.dylib`). Docker images and GitHub Release artifacts include pre-built binaries for Linux x86_64. For other platforms, use the [Source Build](#build-from-source) path.

---

## Docker Quickstart

The fastest way to try Dunena — no Bun or Zig installation needed.

```bash
# Build and start (from repo root)
docker compose -f deploy/docker-compose.yml up -d

# Verify it's running
curl http://localhost:3000/health

# Try it out
curl -X POST http://localhost:3000/cache/hello \
  -H "Content-Type: application/json" \
  -d '{"value": "world"}'

curl http://localhost:3000/cache/hello

# Stop
docker compose -f deploy/docker-compose.yml down
```

**Endpoints available:**

| URL | Description |
|-----|-------------|
| `http://localhost:3000/health` | Health check |
| `http://localhost:3000/dashboard` | Admin dashboard |
| `http://localhost:3000/docs` | Documentation |
| `ws://localhost:3000/ws` | WebSocket |

**Persistent data:** SQLite database and snapshots are stored in a Docker volume mounted at `/var/lib/dunena`. Data survives container restarts.

**Environment profiles:** Select `dev`, `staging`, or `prod`:

```bash
DUNENA_ENV=prod docker compose -f deploy/docker-compose.yml up -d
```

See [deploy/README.md](deploy/README.md) for full deployment configuration.

---

## GitHub Release

Download a pre-built release bundle from [GitHub Releases](https://github.com/OwenBellowen/dunena/releases).

Each release includes:
- Pre-built Zig native library (Linux x86_64)
- Bundled server and CLI (JavaScript, runs on Bun)
- Sample configuration

```bash
# 1. Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# 2. Download and extract the release
curl -fsSL https://github.com/OwenBellowen/dunena/releases/latest/download/dunena-v0.2.0.tar.gz | tar xz

# 3. Start the server
cd release
bun run server/server.js
```

> **Platform note:** Release binaries are currently built for **Linux x86_64** only. For macOS or Windows, use the [Source Build](#build-from-source) or [Docker](#docker-quickstart) paths.

---

## Build from Source

For contributors, developers, or when you need a platform-native build.

### Prerequisites

- **Bun** ≥ 1.0 — [bun.sh](https://bun.sh/)
- **Zig** ≥ 0.15.2 — [ziglang.org/download](https://ziglang.org/download/)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/OwenBellowen/dunena.git
cd dunena

# 2. Install TypeScript dependencies
bun install

# 3. Build the Zig native library
bun run build:zig

# 4. Start the server
bun run start
```

The server starts on **http://localhost:3000** by default.

### Development Mode

```bash
# Watch mode — auto-restarts on TypeScript changes
bun run dev
```

> **Tip:** After modifying any `.zig` file, you must re-run `bun run build:zig` before the changes take effect.

### Verify Your Setup

```bash
# Run the sanity checker
bun run cli -- doctor

# Run the full test suite
bun run test:all
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun run start` | Start the server |
| `bun run dev` | Start with file watching |
| `bun run build:zig` | Build Zig native library (ReleaseSafe) |
| `bun run build:zig:debug` | Build Zig with debug symbols |
| `bun run cli -- <cmd>` | Run CLI commands |
| `bun run test:all` | Run Zig + TypeScript tests |
| `bun run check` | TypeScript type-check |
| `bun run clean` | Remove Zig and app build artifacts (`zig/zig-out`, `*/dist`) |
| `bun run clean:zig` | Remove Zig build output and cache (`zig/zig-out`, `zig/.zig-cache`) |
| `bun run clean:apps` | Remove bundled app output (`apps/server/dist`, `apps/cli/dist`) |
| `bun run clean:data` | **Destructive:** Remove SQLite database files (`apps/server/data/`) |
| `bun run clean:release` | Remove release bundles (`release/`, `dunena-*.tar.gz`) |
| `bun run clean:all` | **Destructive:** Remove all of the above plus `node_modules` and `bun.lock` |

---

## Kubernetes

For production deployment on Kubernetes.

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.example.yaml   # Replace values first!
kubectl apply -f deploy/k8s/pvc.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
```

> ⚠️ **SQLite is single-writer.** Do not set `replicas` > 1. See [deploy/README.md](deploy/README.md) for supported deployment modes and constraints.

---

## Configuration

All settings are controlled via environment variables. See the full list in the [README](README.md#configuration) or the [docs site](http://localhost:3000/docs/configuration).

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNENA_PORT` | `3000` | HTTP server port |
| `DUNENA_HOST` | `127.0.0.1` | Bind address |
| `DUNENA_AUTH_TOKEN` | — | Bearer token (disabled if unset) |
| `DUNENA_DB` | `true` | Enable SQLite database layer |
| `DUNENA_PERSIST` | `false` | Enable disk persistence (snapshots) |

---

## What's Available Today vs. Planned

| Feature | Status | Notes |
|---------|--------|-------|
| Docker image | ✅ Available | Build from source via Dockerfile |
| GitHub Release artifacts | ✅ Available | Linux x86_64 binaries |
| Source build (all platforms) | ✅ Available | Requires Bun + Zig |
| Kubernetes manifests | ✅ Available | Single-replica only |
| `bunx dunena` / npm install | 🔜 Planned | Packages are not yet published to npm |
| Pre-built macOS/Windows binaries | 🔜 Planned | Currently Linux-only in releases |
| `@dunena/client` SDK | 🔜 Planned | HTTP client library for programmatic use |

---

## Troubleshooting

**"Cannot find native library"** — Run `bun run build:zig` to compile the Zig shared library. The FFI bridge looks for it in `zig/zig-out/lib/` and `zig/zig-out/bin/`.

**"Zig not found"** — Install Zig 0.15.2+ from [ziglang.org/download](https://ziglang.org/download/). Ensure `zig` is on your PATH.

**Port conflict** — Set `DUNENA_PORT=3001` (or any free port) as an environment variable.

**Docker build fails** — Ensure Docker is running and you're building from the repo root: `docker build -f apps/server/Dockerfile -t dunena/server:local .`
