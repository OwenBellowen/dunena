# Dunena

![Dunena logo](assets/logo.svg)

High-performance cache engine combining a native Zig core with a Bun/TypeScript control layer.

## Overview
Dunena provides a fast cache service with:
- LRU caching, Bloom filters, and run-length encoding (Zig)
- REST API, WebSocket server, and CLI tool (Bun)
- SQLite-backed durable storage