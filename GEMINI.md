# Gemini Agent Workspace

This file serves as a verification and workflow synchronization point for Gemini agents working on the Dunena project.

## Responsibilities
- Planning additional features, addons, tooling, and scripts.
- Creating and defining agent skills based on the codebase.
- Periodic synchronization and monitoring of other agents' progress.

## Current Status
- **Active Task**: Planning features, addons, and agent skills.
- **Last Action**: Full codebase audit completed on 2026-05-10. Expanded `AGENT_SUGGESTIONS.md` with:
  - Priority matrix (P0–P3) across 11 items
  - Detailed implementation specs referencing exact files and line numbers
  - 3 new proposals (Health Check Enhancements, OpenTelemetry, ARC Eviction Policy)
  - 2 new agent skills (`sdk-development`, `devops-infrastructure`, `testing-quality`)
  - Architecture Decision Records (ADRs) documenting codebase conventions
  - Refined tooling proposals (k6 benchmarks, Python SDK, Helm chart, Snapshot CLI)
- **Monitoring**: Keeping track of the NextJS documentation migration occurring in `packages/platform/docs`.

## Workflows
1. Log all suggestions and architectural plans in `AGENT_SUGGESTIONS.md`.
2. Do not modify or interact with `packages/platform/docs` directly, as it is owned by the documentation migration agent.
3. Periodically check `CLAUDE.md` and `packages/platform/docs` (read-only) for progress updates from the documentation agent.
