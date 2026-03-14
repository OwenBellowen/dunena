<div align="center">

# Dunena

[![CI](https://img.shields.io/github/actions/workflow/status/owenbellowen/dunena/ci.yml?branch=main&label=CI)](https://github.com/owenbellowen/dunena/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![Zig](https://img.shields.io/badge/native-Zig-orange)](https://ziglang.org)

I built Dunena as a fast cache service with a native Zig engine and a Bun/TypeScript control layer.
It exposes REST, WebSocket, CLI, dashboard, metrics, and a SQLite-backed persistence/query-cache layer.

</div>

```
┌──────────────────────────────────────────────────────────┐
│                    Bun / TypeScript                      │
│                                                          │
│   REST API · WebSocket · CLI · Dashboard · Analytics     │
│                                                          │
├───────────────────────┬──────────────────────────────────┤
│    Bun FFI Bridge     │     bun:sqlite (Database)        │
├───────────────────────┤  SQLite KV · Query Cache ·       │
│  Zig Core (.dll/etc)  │  DB Proxy · Tag Invalidation     │
│                       │                                  │
│  LRU · Bloom · RLE    │  Durable storage with TTL,       │
│  · Stats              │  namespaces, and tagging         │
└───────────────────────┴──────────────────────────────────┘
```

## Quick Links

- Getting started: [Quick Start](#quick-start)
- API docs: [API Reference](#api-reference)
- Configuration: [Configuration](#configuration)
- Deployment assets: [deploy/README.md](deploy/README.md)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## Features

| Layer | Feature |
|-------|---------|
| **Zig Core** | LRU cache with O(1) get/put/delete backed by hash map + doubly-linked list |
| | Bloom filter for probabilistic membership testing |
| | Run-length encoding compression / decompression |
| | Statistics engine (mean, variance, std dev, percentiles, histogram) |
| **TypeScript** | RESTful HTTP API with full CRUD + batch operations |
| | WebSocket server with real-time cache event streaming |
| | CLI tool for interacting with a running server |
| | Admin dashboard (single HTML page, no build step) |
| | Full documentation website served at `/docs` |
| | Namespace-scoped caching with optional TTL |
| | Key scanning with glob pattern matching |
| | Transparent compression for large values (Zig RLE) |
| | Disk persistence — periodic snapshots + on-demand save/restore |
| | Pub/Sub event bus for internal decoupling |
| | Analytics service with latency tracking (uses Zig stats) |
| | Prometheus metrics endpoint (`/metrics`) |
| | Rate limiting (HTTP + WebSocket), CORS, token authentication middleware |
| **Database** | SQLite durable key-value store via `bun:sqlite` (zero dependencies) |
| | Tag-based storage with tag-scoped invalidation |
| | Query cache service — cache database query results with automatic TTL |
| | Two-level caching: L1 in-memory (Zig) → L2 persistent (SQLite) |
| | Database proxy — cache-aside layer for PostgreSQL, MySQL, HTTP APIs |
| | Connector registry for managing multiple external database connections |
| | Automatic expired-entry purge with configurable intervals |

## Prerequisites

- **Zig** ≥ 0.15.2 — [ziglang.org/download](https://ziglang.org/download/)
- **Bun** ≥ 1.0 — [bun.sh](https://bun.sh/)

## Quick Start

```bash
# 1. Install TypeScript dependencies
bun install

# 2. Build the Zig shared library
bun run build:zig

# 3. Start the server
bun run start
```

The server starts on **http://localhost:3000** by default.

- Dashboard: **http://localhost:3000/dashboard**
- Documentation: **http://localhost:3000/docs**
- WebSocket: **ws://localhost:3000/ws**
- Prometheus metrics: **http://localhost:3000/metrics**

## Monorepo Operations

```bash
# Run server (apps/server)
bun run start

# Run CLI (apps/cli)
bun run cli -- --help

# Full validation
bun run check
bun run test:all
```

## Release & Deployment

### CI/CD

- CI workflow: `.github/workflows/ci.yml`
- Release workflow: `.github/workflows/release.yml`

CI pipeline:

1. Install Bun + Zig
2. Type-check
3. Run full test suite (Zig + platform)
4. Build server and CLI bundles

Release workflow packages artifacts and publishes a GitHub Release for tags matching `v*`.

### Release Packaging

```bash
# Validate + build release assets locally
bun run release:prepare
```

This produces:

- Zig shared library build output
- Server bundle (`apps/server/dist`)
- CLI bundle (`apps/cli/dist`)

### Environment Profiles and Deployment

- Env profiles: `deploy/env/.env.dev`, `deploy/env/.env.staging`, `deploy/env/.env.prod`
- Docker compose: `deploy/docker-compose.yml`
- Kubernetes manifests: `deploy/k8s/*`

```bash
# Docker local/staging/prod profile
DUNENA_ENV=dev bun run docker:up

# Kubernetes (example)
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/pvc.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
```

See `deploy/README.md` for full deployment instructions.

## Project Structure

```
dunena/
├── apps/
│   ├── server/                 # Deployable API server app
│   │   ├── package.json
│   │   └── src/index.ts        # starts @dunena/platform server
│   └── cli/                    # Deployable CLI app
│       ├── package.json
│       └── src/index.ts
├── packages/
│   └── platform/               # Core product package
│       ├── src/
│       │   ├── runtime.ts      # startServer() export
│       │   ├── bridge/         # Bun FFI bridge to Zig
│       │   ├── server/         # HTTP + WebSocket app
│       │   ├── services/       # cache, db, analytics, persistence
│       │   ├── db/             # SQLite + query cache + proxy
│       │   ├── cli/            # shared CLI implementation
│       │   ├── utils/
│       │   └── types/
│       ├── tests/              # integration + unit tests
│       ├── docs/               # docs site served at /docs
│       ├── public/             # dashboard assets
│       ├── package.json
│       ├── tsconfig.json
│       └── bunfig.toml
├── zig/                        # Zig native core
│   ├── build.zig               # Build system
│   ├── build.zig.zon           # Package manifest
│   └── src/
│       ├── cache.zig           # LRU cache (hash map + linked list)
│       ├── bloom_filter.zig    # Bloom filter (FNV-1a + djb2)
│       ├── compression.zig     # RLE compression
│       ├── stats.zig           # Statistical computations
│       └── exports.zig         # C-ABI exports + tests
├── tsconfig.base.json          # Shared TS compiler config
├── package.json
└── bunfig.toml
```

## API Reference

> Full documentation available at **http://localhost:3000/docs/api** when the server is running.

### Cache CRUD

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET` | `/cache/:key` | — | Get a cached value |
| `POST` | `/cache/:key` | `{ value, ttl?, ns? }` | Set a value |
| `DELETE` | `/cache/:key` | — | Delete a value |

All CRUD endpoints accept an optional `?ns=` query parameter for namespace scoping.

### Batch Operations

```bash
# Multi-get
curl -X POST localhost:3000/cache \
  -H 'Content-Type: application/json' \
  -d '{"action":"mget","keys":["a","b","c"]}'

# Multi-set
curl -X POST localhost:3000/cache \
  -H 'Content-Type: application/json' \
  -d '{"action":"mset","entries":[{"key":"a","value":"1"},{"key":"b","value":"2"}]}'
```

### Key Scanning

```bash
# List all keys
curl "localhost:3000/keys"

# Filter by glob pattern
curl "localhost:3000/keys?pattern=user-*&ns=sessions&count=50"
```

### Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/stats` | Cache stats + latency metrics |
| `GET` | `/stats/history` | Analytics snapshots history |
| `POST` | `/flush` | Clear all cached data |
| `POST` | `/snapshot` | Save cache to disk (persistence) |
| `GET` | `/info` | Server info |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus-format metrics |
| `GET` | `/keys` | Key scanning with pattern, namespace, cursor |

### SQLite Database (Durable Storage)

All `/db` endpoints provide persistent key-value storage backed by SQLite with namespacing, TTL, and tagging.

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET` | `/db/:key` | — | Get a stored entry (includes tags, timestamps) |
| `POST` | `/db/:key` | `{ value, ttl?, ns?, tags? }` | Store an entry |
| `DELETE` | `/db/:key` | — | Delete an entry |
| `POST` | `/db` | `{ action: "mget", keys }` | Batch get |
| `POST` | `/db` | `{ action: "mset", entries }` | Batch set |
| `POST` | `/db` | `{ action: "mdelete", keys }` | Batch delete |
| `POST` | `/db` | `{ action: "query", ... }` | Query with prefix, tags, ordering |
| `POST` | `/db` | `{ action: "deleteByTags", tags }` | Delete by tags |
| `GET` | `/db-stats` | — | Storage statistics |
| `GET` | `/db-keys` | — | List keys with pattern |
| `POST` | `/db-clear` | — | Clear all entries |
| `POST` | `/db-purge` | — | Purge expired entries |

```bash
# Store with tags
curl -X POST localhost:3000/db/user:42 \
  -H 'Content-Type: application/json' \
  -d '{"value": "{\"name\":\"Alice\"}", "tags": ["users", "active"], "ttl": 3600000}'

# Query by prefix and tags
curl -X POST localhost:3000/db \
  -H 'Content-Type: application/json' \
  -d '{"action": "query", "pattern": "user:", "tags": ["active"], "limit": 50}'

# Invalidate all entries tagged "users"
curl -X POST localhost:3000/db \
  -H 'Content-Type: application/json' \
  -d '{"action": "deleteByTags", "tags": ["users"]}'
```

### Query Cache

Cache external database query results with automatic TTL and tag-based invalidation.

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET` | `/query-cache/:key` | — | Get a cached query result |
| `POST` | `/query-cache` | `{ key, data, ttl?, tags? }` | Cache a query result |
| `POST` | `/query-cache/invalidate` | `{ tags? }` or `{ key? }` | Invalidate cached results |
| `GET` | `/query-cache/stats` | — | Query cache statistics |
| `POST` | `/query-cache/clear` | — | Clear all cached queries |

```bash
# Cache a query result
curl -X POST localhost:3000/query-cache \
  -H 'Content-Type: application/json' \
  -d '{"key": "users-page-1", "data": [{"id":1,"name":"Alice"}], "tags": ["users"], "ttl": 60000}'

# Invalidate when the "users" table changes
curl -X POST localhost:3000/query-cache/invalidate \
  -H 'Content-Type: application/json' \
  -d '{"tags": ["users"]}'
```

### Database Proxy

Register external database connections and proxy queries through Dunena with automatic caching.

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET` | `/db-proxy/connectors` | — | List registered connectors |
| `POST` | `/db-proxy/register` | `{ name, type, connectionString, ... }` | Register a connector |
| `POST` | `/db-proxy/unregister` | `{ name }` | Remove a connector |
| `POST` | `/db-proxy/query` | `{ connector, query, params?, ... }` | Execute a proxied query |
| `POST` | `/db-proxy/invalidate` | `{ tags }` | Invalidate cached proxy results |

```bash
# Register a Supabase connector
curl -X POST localhost:3000/db-proxy/register \
  -H 'Content-Type: application/json' \
  -d '{"name": "supabase", "type": "http", "connectionString": "https://your-project.supabase.co/rest/v1/rpc/query", "readOnly": true}'

# Execute a proxied query (auto-cached)
curl -X POST localhost:3000/db-proxy/query \
  -H 'Content-Type: application/json' \
  -d '{"connector": "supabase", "query": "SELECT * FROM users", "tags": ["users"]}'
```

### WebSocket

Connect to `ws://localhost:3000/ws` and send JSON messages:

```jsonc
{ "type": "ping" }
{ "type": "subscribe", "channel": "cache-events" }
{ "type": "get", "key": "mykey" }
{ "type": "set", "key": "mykey", "value": "myvalue" }
{ "type": "del", "key": "mykey" }
```

## CLI

```bash
bun run cli -- get <key>               # Get a value
bun run cli -- set <key> <value> [ttl]  # Set a value
bun run cli -- del <key>                # Delete a key
bun run cli -- mget <key1> <key2> ...   # Batch get
bun run cli -- mset k1=v1 k2=v2 ...     # Batch set
bun run cli -- keys [pattern]           # Scan keys
bun run cli -- stats                    # Cache stats
bun run cli -- flush                    # Clear cache
bun run cli -- info                     # Server info
bun run cli -- bench [count]            # Benchmark

# Database commands
bun run cli -- db-get <key>             # Get a durable DB entry
bun run cli -- db-set <key> <val> [ttl] # Store a durable DB entry
bun run cli -- db-del <key>             # Delete a DB entry
bun run cli -- db-keys [pattern]        # List DB keys
bun run cli -- db-stats                 # Database statistics
bun run cli -- db-clear                 # Clear database
bun run cli -- db-purge                 # Purge expired entries

# Query cache commands
bun run cli -- qc-get <key>             # Get cached query result
bun run cli -- qc-set <key> <json>      # Cache a query result
bun run cli -- qc-invalidate <tag...>   # Invalidate by tags
bun run cli -- qc-stats                 # Query cache statistics
bun run cli -- qc-clear                 # Clear query cache

# Database proxy commands
bun run cli -- db-proxy-list            # List connectors
bun run cli -- db-proxy-register <n> <type> <url>  # Register connector
bun run cli -- db-proxy-query <conn> <query>       # Proxied query

# Flags
--ns=<namespace>    # Scope to a namespace
--json              # Compact JSON output
```

## Configuration

All settings can be overridden via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNENA_PORT` | `3000` | HTTP server port |
| `DUNENA_HOST` | `127.0.0.1` | Bind address |
| `DUNENA_MAX_ENTRIES` | `100000` | Maximum cache entries |
| `DUNENA_DEFAULT_TTL` | `0` | Default TTL in ms (0 = no expiry) |
| `DUNENA_AUTH_TOKEN` | — | Bearer token (disabled if unset) |
| `DUNENA_BLOOM_FILTER` | `true` | Enable bloom filter |
| `DUNENA_BLOOM_SIZE` | `1000000` | Bloom filter bit count |
| `DUNENA_BLOOM_HASHES` | `7` | Bloom filter hash function count |
| `DUNENA_COMPRESSION_THRESHOLD` | `0` | Auto-compress values ≥ N bytes (0 = off) |
| `DUNENA_LOG_LEVEL` | `info` | debug / info / warn / error |
| `DUNENA_LOG_FORMAT` | `text` | text / json |
| `DUNENA_RATE_MAX` | `1000` | Max requests per window |
| `DUNENA_RATE_WINDOW` | `60000` | Rate limit window (ms) |
| `DUNENA_CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `DUNENA_WS` | `true` | Enable WebSocket endpoint |
| `DUNENA_DASHBOARD` | `true` | Enable admin dashboard |
| `DUNENA_PERSIST` | `false` | Enable disk persistence |
| `DUNENA_PERSIST_PATH` | `./data/dunena-snapshot.json` | Snapshot file path |
| `DUNENA_PERSIST_INTERVAL` | `300000` | Auto-save interval in ms (0 = off) |
| `DUNENA_PERSIST_ON_SHUTDOWN` | `true` | Save snapshot on graceful shutdown |
| `DUNENA_DB` | `true` | Enable SQLite database layer |
| `DUNENA_DB_PATH` | `./data/dunena.db` | SQLite database file path |
| `DUNENA_QUERY_CACHE_TTL` | `60000` | Default query cache TTL (ms) |
| `DUNENA_DB_PURGE_INTERVAL` | `60000` | Expired entry purge interval (ms) |

## Testing

```bash
# Run all tests from repo root (Zig + TypeScript)
bun run test:all
```

## Architecture

The **Zig core** compiles to a platform-native shared library (`.dll` / `.so` / `.dylib`). At startup,
the TypeScript layer loads it via **Bun FFI** (`bun:ffi`), which provides zero-overhead calls into the
native code — no Node-API bindings, no WASM overhead.

Cache operations (`get`, `put`, `delete`) execute entirely in Zig with O(1) amortized complexity.
The LRU eviction policy is maintained by a doubly-linked list that's updated on every access.
An optional **bloom filter** sits in front of the cache to short-circuit lookups for keys that
definitely don't exist, reducing unnecessary hash-map probes.

The **analytics service** feeds recorded latencies into the Zig **statistics engine** for
efficient percentile calculations (p50, p95, p99) — demonstrating cross-language data flow
where TypeScript collects raw data and Zig crunches the numbers.

## License

MIT

## Community and Open Source

This project is open source and intended for public use and contribution.

- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Pull request template: [.github/pull_request_template.md](.github/pull_request_template.md)
- Issue templates: [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE)

If you fork this repository, review [.github/ISSUE_TEMPLATE/config.yml](.github/ISSUE_TEMPLATE/config.yml)
and replace the security advisory URL with your own repository path.
