# Installing & Running Dunena

Choose the installation method that fits your use case.

## Installation Methods

| Method | Best For | Prerequisites | Native Build? |
|--------|----------|---------------|---------------|
| [Quick Try (CLI)](#quick-try-cli) | Instant CLI usage | None (uses bunx) | No |
| [Docker](#docker-quickstart) | Quick trial, deployment | Docker | No |
| [GitHub Release](#github-release) | Standalone server | Bun | No |
| [Source Build](#build-from-source) | Contributors, development | Bun + Zig | Yes |
| [Kubernetes](#kubernetes) | Production deployment | kubectl + Docker | No |
| [Clustered](#clustered-deployment) | High availability | Any of the above | Depends |

> **Note:** Dunena requires a platform-native shared library (Zig → `.dll`/`.so`/`.dylib`) for the **server**. Docker images and GitHub Release artifacts include pre-built binaries for Linux x86_64. The CLI client (`bunx dunena`) works on all platforms and requires no native build.

---

## Quick Try (CLI)

The fastest way to interact with a running Dunena server — no clone or install needed.

```bash
# Install + run in one command
bunx dunena health

# Set and get values
bunx dunena set hello world
bunx dunena get hello

# View stats
bunx dunena stats

# Run a benchmark
bunx dunena bench 500
```

The CLI connects to `http://localhost:3000` by default. Point it elsewhere with:

```bash
DUNENA_URL=http://my-server:3000 bunx dunena stats
```

> **Note:** `bunx dunena` provides **client commands only** (get/set/del/stats/bench/etc.). To run the server itself, use [Docker](#docker-quickstart) or [Source Build](#build-from-source).

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
| `http://localhost:3000/graphql` | GraphQL playground |
| `ws://localhost:3000/ws` | WebSocket |

**Persistent data:** SQLite database and snapshots are stored in a Docker volume mounted at `/var/lib/dunena`. Data survives container restarts.

**Environment profiles:** Select `dev`, `staging`, or `prod`:

```bash
DUNENA_ENV=prod docker compose -f deploy/docker-compose.yml up -d
```

**Enable Redis protocol in Docker:**

```bash
DUNENA_REDIS_ENABLED=true docker compose -f deploy/docker-compose.yml up -d
```

See [deploy/README.md](deploy/README.md) for full deployment configuration.

---

## GitHub Release

Download a pre-built release bundle from [GitHub Releases](https://github.com/PowenCu/dunena/releases).

Each release includes:
- Pre-built Zig native library (Linux x86_64)
- Bundled server and CLI (JavaScript, runs on Bun)
- Sample configuration

```bash
# 1. Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# 2. Download and extract the release
curl -fsSL https://github.com/PowenCu/dunena/releases/latest/download/dunena-latest.tar.gz | tar xz

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
git clone https://github.com/PowenCu/dunena.git
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

> ⚠️ **SQLite is single-writer.** Do not set `replicas` > 1 unless you enable clustering. With clustering enabled, each replica gets its own SQLite file and the leader coordinates writes. See [Clustered Deployment](#clustered-deployment).

---

## Clustered Deployment

For high-availability setups with automatic failover. Dunena uses a gossip-based membership protocol with Bully algorithm leader election.

### Local Development (3 nodes)

```bash
# Terminal 1 — Node A (highest priority, will become leader)
DUNENA_PORT=3000 \
DUNENA_CLUSTER_ENABLED=true \
DUNENA_CLUSTER_NODE_ID=node-a \
DUNENA_CLUSTER_PRIORITY=300 \
DUNENA_CLUSTER_SEEDS=127.0.0.1:3001,127.0.0.1:3002 \
bun run start

# Terminal 2 — Node B (follower)
DUNENA_PORT=3001 \
DUNENA_DB_PATH=./data/dunena-b.db \
DUNENA_CLUSTER_ENABLED=true \
DUNENA_CLUSTER_NODE_ID=node-b \
DUNENA_CLUSTER_PRIORITY=200 \
DUNENA_CLUSTER_SEEDS=127.0.0.1:3000,127.0.0.1:3002 \
bun run start

# Terminal 3 — Node C (follower)
DUNENA_PORT=3002 \
DUNENA_DB_PATH=./data/dunena-c.db \
DUNENA_CLUSTER_ENABLED=true \
DUNENA_CLUSTER_NODE_ID=node-c \
DUNENA_CLUSTER_PRIORITY=100 \
DUNENA_CLUSTER_SEEDS=127.0.0.1:3000,127.0.0.1:3001 \
bun run start
```

### How Clustering Works

1. **Startup** — Each node contacts seed addresses to join the cluster.
2. **Leader Election** — The node with the highest `DUNENA_CLUSTER_PRIORITY` becomes leader. If the leader dies, the next highest-priority node takes over automatically.
3. **Replication** — The leader pushes all writes to followers via HTTP. Followers serve reads from their local in-memory cache.
4. **Failure Detection** — Nodes broadcast heartbeats every 2 seconds. A node is marked _suspect_ after 6 seconds of silence, and _dead_ after 15 seconds — triggering a new election if the dead node was the leader.

### Verify Cluster Status

```bash
# Check which node is the leader
curl http://localhost:3000/_cluster/stats

# See all cluster members
curl http://localhost:3000/_cluster/members
```

### Kubernetes Clustered Deployment

For a Kubernetes-native clustered deployment, use a StatefulSet instead of a Deployment. Each pod should have:
- A unique `DUNENA_CLUSTER_NODE_ID` (use the pod name)
- Its own PVC for the SQLite database
- Seed addresses pointing to the headless service DNS names

---

## Enabling Optional Features

### Redis Protocol

Accept standard Redis client connections alongside the HTTP API:

```bash
# Add to your .env or pass as environment variable
DUNENA_REDIS_ENABLED=true
DUNENA_REDIS_PORT=6379
```

Then use any Redis client:

```bash
redis-cli -p 6379
> PING
PONG
> SET mykey myvalue
OK
> GET mykey
"myvalue"
```

### OpenTelemetry

Export traces and metrics to any OTLP-compatible backend (Jaeger, Grafana Tempo, Datadog):

```bash
DUNENA_OTEL_ENABLED=true
DUNENA_OTEL_ENDPOINT=http://localhost:4318
DUNENA_OTEL_SERVICE_NAME=dunena
```

### GraphQL

The GraphQL endpoint is available at `/graphql` when `graphql-yoga` is installed (included by default). No additional configuration needed.

```bash
# Query cache stats
curl -X POST localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ stats { hits misses hitRate currentSize } }"}'
```

---

## Python SDK

Install the official Python client:

```bash
pip install dunena
```

```python
from dunena import Dunena

client = Dunena("http://localhost:3000")
client.set("hello", "world", ttl=60000)
print(client.get("hello"))  # → "world"
print(client.stats())
```

See `sdks/python/` for the full API and async client.

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
| `DUNENA_REDIS_ENABLED` | `false` | Enable Redis protocol adapter |
| `DUNENA_OTEL_ENABLED` | `false` | Enable OpenTelemetry export |
| `DUNENA_CLUSTER_ENABLED` | `false` | Enable HA clustering |

See `.env.example` for the complete list of all environment variables.

---

## What's Available Today

| Feature | Status | Notes |
|---------|--------|-------|
| `bunx dunena` CLI | ✅ Available | CLI client for all cache/db operations |
| Docker image | ✅ Available | Build from source via Dockerfile |
| GitHub Release artifacts | ✅ Available | Linux x86_64 binaries |
| Source build (all platforms) | ✅ Available | Requires Bun + Zig |
| Kubernetes manifests | ✅ Available | Single-replica or clustered |
| Redis protocol (RESP2) | ✅ Available | Use any Redis client |
| GraphQL API | ✅ Available | Full query/mutation/subscription |
| OpenTelemetry | ✅ Available | OTLP traces and metrics |
| Clustering / HA | ✅ Available | Leader election + auto-replication |
| Python SDK | ✅ Available | Sync + async clients |
| Cloud storage backup | ✅ Available | S3-compatible backends |
| Pre-built macOS/Windows binaries | 🔜 Planned | Currently Linux-only in releases |

---

## Troubleshooting

**"Cannot find native library"** — Run `bun run build:zig` to compile the Zig shared library. The FFI bridge looks for it in `zig/zig-out/lib/` and `zig/zig-out/bin/`.

**"Zig not found"** — Install Zig 0.15.2+ from [ziglang.org/download](https://ziglang.org/download/). Ensure `zig` is on your PATH.

**Port conflict** — Set `DUNENA_PORT=3001` (or any free port) as an environment variable.

**Docker build fails** — Ensure Docker is running and you're building from the repo root: `docker build -f apps/server/Dockerfile -t dunena/server:local .`

**Cluster nodes can't discover each other** — Ensure `DUNENA_CLUSTER_SEEDS` contains the correct `host:port` addresses. Nodes must be able to reach each other on their HTTP ports. Check firewall rules and use `/_cluster/members` to debug membership.

**Redis clients can't connect** — Ensure `DUNENA_REDIS_ENABLED=true` is set and the `DUNENA_REDIS_PORT` (default 6379) is not blocked. Check with `redis-cli -p 6379 PING`.

**OpenTelemetry traces not appearing** — Verify the `DUNENA_OTEL_ENDPOINT` is reachable and the OTLP collector is running. Dunena uses the HTTP OTLP exporter (port 4318 by default, not the gRPC port 4317).
