# Dunena k6 Benchmark Suite

Performance benchmarking scripts for the Dunena cache engine using [k6](https://k6.io/).

## Prerequisites

```bash
# Install k6
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows
winget install k6 --source winget

# Docker
docker run --rm -i grafana/k6 run - <scripts/bench/k6/cache-crud.js
```

## Usage

Make sure a Dunena server is running first:

```bash
bun run start
```

Then run benchmarks:

```bash
# Basic cache CRUD throughput
k6 run scripts/bench/k6/cache-crud.js

# Batch operations
k6 run scripts/bench/k6/cache-batch.js

# Realistic mixed workload (80% read / 20% write)
k6 run scripts/bench/k6/mixed-workload.js

# Custom configuration
k6 run scripts/bench/k6/cache-crud.js --vus 100 --duration 60s
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNENA_URL` | `http://localhost:3000` | Server URL |
| `DUNENA_AUTH_TOKEN` | — | Bearer token (if auth is enabled) |

```bash
DUNENA_URL=http://staging:3000 DUNENA_AUTH_TOKEN=secret k6 run scripts/bench/k6/cache-crud.js
```

## Benchmarks

| Script | What it tests | Default Config |
|--------|--------------|----------------|
| `cache-crud.js` | GET / SET / DEL throughput | 20 VUs × 15s per op |
| `cache-batch.js` | MGET / MSET batch ops | 10 VUs × 15s, batch=20 |
| `mixed-workload.js` | Realistic 80/20 read/write | Staged 20→50→100→0 VUs |

## Thresholds

The benchmarks enforce the following performance requirements:

- **GET**: p95 < 10ms, p99 < 25ms
- **SET**: p95 < 15ms, p99 < 30ms
- **DELETE**: p95 < 10ms, p99 < 25ms
- **Error rate**: < 1%
