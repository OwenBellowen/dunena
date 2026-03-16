# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-03-16

### Added

- FFI boundary tests for edge cases (empty keys, oversized values, create/destroy cycles)
- ABI-safety docstrings in `exports.zig` and `ffi.ts`
- Zero-length input guards in Zig exports (bloom filter, stats)
- CI dependency caching for Zig build artifacts
- Separate lint job in CI for faster feedback
- `CHANGELOG.md` scaffold
- `CODEOWNERS` file
- Expanded `CONTRIBUTING.md` with developer quickstart and architecture overview

### Changed

- Unified Zig setup action across CI and release workflows (`mlugg/setup-zig@v2.2.1`)
- Improved `.gitignore` patterns
- Improved FFI bridge safety in `cache-bridge.ts` to handle zero-length strings gracefully (Bun FFI compatibility)

### Fixed

- Potential undefined behavior in stats exports when called with zero-length data
- TypeError in Bun FFI when passing empty ArrayBufferView to `ptr()`
