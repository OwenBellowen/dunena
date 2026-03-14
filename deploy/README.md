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

## Production Notes

- Replace the image in `deploy/k8s/deployment.yaml` with your published image.
- Replace values in `deploy/k8s/secret.example.yaml` before applying.
- Keep `DUNENA_AUTH_TOKEN` set in staging/prod.
- Keep JSON logs in staging/prod (`DUNENA_LOG_FORMAT=json`).
- Persist database state by keeping `DUNENA_DB_PATH` on mounted storage.
