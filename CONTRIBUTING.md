# Contributing to Dunena

Thanks for your interest in contributing.

## Development setup

1. Install Bun and Zig.
2. Install dependencies: `bun install`
3. Build Zig core: `bun run build:zig`
4. Run checks and tests:
   - `bun run check`
   - `bun run test:all`

## Monorepo structure

- `apps/server`: deployable server entrypoint
- `apps/cli`: deployable CLI entrypoint
- `packages/platform`: core runtime and tests
- `zig`: native engine

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
