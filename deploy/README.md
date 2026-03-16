# Deployment Guide

This repository includes production deployment assets for local Docker and Kubernetes.

## Environment Profiles

Environment files are in `deploy/env/`:

- `.env.dev`
- `.env.staging`
- `.env.prod`

Select one when running docker-compose:

```bash
# dev profile
DUNENA_ENV=dev docker compose -f deploy/docker-compose.yml up -d

# staging profile
DUNENA_ENV=staging docker compose -f deploy/docker-compose.yml up -d

# prod profile
DUNENA_ENV=prod docker compose -f deploy/docker-compose.yml up -d
```

## Docker

Build and run via root scripts:

```bash
bun run docker:build
bun run docker:up
bun run docker:down
```

## Kubernetes

Apply manifests in order:

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.example.yaml
kubectl apply -f deploy/k8s/pvc.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
```

Optional ingress:

```bash
kubectl apply -f deploy/k8s/ingress.example.yaml
```

## Supported Deployment Modes

| Mode | SQLite Safe? | Notes |
|------|-------------|-------|
| Local development | ✅ | Single process, no durability concerns |
| Single-node / VPS | ✅ | One server process with persistent disk |
| Docker single-instance | ✅ | Mount a volume for `/var/lib/dunena` |
| Kubernetes (1 replica) | ✅ | Use `ReadWriteOnce` PVC, `Recreate` strategy |
| Kubernetes (>1 replica) | ❌ | **Will corrupt SQLite** — do not scale replicas |
| Multi-node horizontal scaling | ❌ | Requires replacing SQLite with a networked database |

## ⚠️ SQLite Constraints

Dunena uses SQLite for durable storage. SQLite is a **single-writer** database:

- **Only one process may write to a given SQLite file at a time.** Running multiple replicas against the same database file **will corrupt data**.
- The Kubernetes deployment manifest ships with `replicas: 1` and the `Recreate` update strategy to prevent two pods from running simultaneously during rollouts.
- The PVC uses `ReadWriteOnce` access mode, which prevents the volume from being mounted by multiple nodes, but does **not** prevent multiple pods on the same node from accessing it.
- **Do not increase `replicas`** unless you replace SQLite with a networked database (e.g., PostgreSQL).
- If you need horizontal scaling, consider disabling the SQLite database layer (`DUNENA_DB=false`) and using only the in-memory Zig cache, which is per-instance and does not require coordination.

## Production Notes

- Replace the image in `deploy/k8s/deployment.yaml` with your published image.
- Replace values in `deploy/k8s/secret.example.yaml` before applying.
- Keep `DUNENA_AUTH_TOKEN` set in staging/prod.
- Keep JSON logs in staging/prod (`DUNENA_LOG_FORMAT=json`).
- Persist database state by keeping `DUNENA_DB_PATH` on mounted storage.

## Health, Readiness & Metrics

The server exposes the following operational endpoints:

| Endpoint | Purpose | Auth Required |
|----------|---------|--------------|
| `GET /health` | Liveness check — returns `{ status: "ok" }` | No |
| `GET /metrics` | Prometheus-format metrics (cache counters, latency quantiles, uptime) | Yes |
| `GET /stats` | JSON cache stats + latency breakdown | Yes |
| `GET /db-stats` | SQLite storage statistics | Yes |

**Kubernetes probes:** The deployment manifest configures both `livenessProbe` and `readinessProbe` against `/health`. These are currently identical — the health check does not verify SQLite reachability. If SQLite becomes unavailable (e.g., disk full), the health check will still pass while `/db` endpoints return errors.

**Metrics:** Scrape `/metrics` with Prometheus. All counter metrics are cumulative from server start. Latency quantiles (p50, p95, p99) reflect the current measurement window.

## Operational Expectations

| Parameter | Value |
|-----------|-------|
| Max key size | 512 bytes (validated by server) |
| Max value size | 4 MB (`MAX_VALUE_SIZE` in cache-bridge) |
| Default TTL | Configurable, `0` = no expiry |
| Persistence | Periodic JSON snapshots + on-demand save; not WAL-replicated |
| In-memory cache | Not persisted across restarts unless snapshot persistence is enabled |
| SQLite durability | Standard SQLite durability; no replication |
| Startup | Restores snapshot from disk if available, then starts HTTP server |
| Shutdown | Saves snapshot if `DUNENA_PERSIST_ON_SHUTDOWN=true`, closes SQLite, stops server |
