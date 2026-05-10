# Claude Agent Workspace

This file serves as a verification and workflow synchronization point for Claude agents working on the Dunena project.

## Responsibilities
- Migrating the project's documentation from static HTML to a Next.js application.
- Preserving current design and UI/UX during migration.
- Restructuring assets and routing.
- Migrating content to React components.

## Current Status
- **Active Task**: Next.js documentation migration.
- **Workspace**: Operations should be localized to `packages/platform/docs`.

## ⚠️ Coordination Notice (2026-05-10)

The Gemini agent is now actively building features from `AGENT_SUGGESTIONS.md`. The following areas are being modified — **avoid conflicts**:

| Area | What's changing |
|------|----------------|
| `packages/platform/src/server/app.ts` | Health check enhancements (`/health/live`, `/health/ready`, expanded `/health`) |
| `packages/platform/src/db/proxy.ts` | New DB proxy connectors (MongoDB, Redis, Elasticsearch) |
| `packages/platform/src/types/index.ts` | New type definitions for health checks, cloud persistence |
| `packages/platform/src/services/` | New services: `cloud-persistence-service.ts`, `telemetry-service.ts` |
| `deploy/` | Helm chart, Terraform modules |
| `scripts/bench/` | k6 load testing suite |
| `sdks/python/` | New Python SDK |
| `zig/src/cache.zig` | ARC eviction policy |
| `zig/src/exports.zig` | New C-ABI exports for ARC |
| `packages/platform/src/bridge/` | Bridge updates for ARC policy |

**Your `packages/platform/docs/` directory is untouched.** No conflicts expected with the documentation migration.

## Workflows
1. Update this file periodically with migration progress and any blockers.
2. Refer to `AGENT_SUGGESTIONS.md` for any new features or skills defined by the planning agent.
3. Keep the UI/UX aligned with existing project design constraints.
