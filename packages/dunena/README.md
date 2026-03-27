# dunena cli

CLI client for the [Dunena](https://github.com/OwenBellowen/dunena) high-performance cache engine.

## Quick Start

```bash
# Check server status
bunx dunena health

# Set a value
bunx dunena set hello world

# Get it back
bunx dunena get hello

# Delete it
bunx dunena del hello

# Run a benchmark
bunx dunena bench 500
```

## Prerequisites

A running Dunena server. See the [installation guide](https://github.com/OwenBellowen/dunena/blob/main/INSTALL.md) for setup options (Docker, source build, or Kubernetes).

By default, the CLI connects to `http://localhost:3000`. Set `DUNENA_URL` to point to a different server:

```bash
DUNENA_URL=http://my-server:3000 bunx dunena stats
```

## Commands

| Command | Description |
|---------|-------------|
| `get <key>` | Get a cached value |
| `set <key> <value> [ttl_ms]` | Set a cached value |
| `del <key>` | Delete a cached value |
| `mget <key1> <key2> ...` | Get multiple values |
| `mset <key=val> ...` | Set multiple key=value pairs |
| `keys [pattern]` | Scan keys (wildcards: `*`, `?`) |
| `stats` | Show cache statistics |
| `health` | Health check |
| `bench [count]` | Run benchmark |
| `doctor` | Check environment & server status |
| `version` | Show CLI version |

See `bunx dunena` (no args) for the full command list including database, query cache, and proxy commands.

## Flags

| Flag | Description |
|------|-------------|
| `--ns=<namespace>` | Scope operations to a namespace |
| `--json` | Output compact JSON (for scripting) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNENA_URL` | `http://localhost:3000` | Server URL |
| `DUNENA_AUTH_TOKEN` | — | Bearer token for authentication |

## License

MIT — see the [main repository](https://github.com/OwenBellowen/dunena) for details.
