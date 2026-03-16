#!/usr/bin/env bun
// ── Dunena CLI ─────────────────────────────────────────────
// Connects to a running Dunena server over HTTP.
export {}; // Mark as ES module for top-level await

const BASE = process.env.DUNENA_URL ?? "http://localhost:3000";
const TOKEN = process.env.DUNENA_AUTH_TOKEN;

// Parse flags from args (--ns=value, --json)
function parseFlags(args: string[]): { positional: string[]; ns?: string; json: boolean } {
  const positional: string[] = [];
  let ns: string | undefined;
  let json = false;
  for (const arg of args) {
    if (arg.startsWith("--ns=")) {
      ns = arg.slice(5);
    } else if (arg === "--json") {
      json = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, ns, json };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}

async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  try {
    const resp = await fetch(`${BASE}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return resp.json();
  } catch (err) {
    console.error(`Error: could not connect to ${BASE}${path}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ── Commands ───────────────────────────────────────────────

const [cmd, ...rawArgs] = process.argv.slice(2);
const { positional: args, ns, json: jsonFlag } = parseFlags(rawArgs);

function output(data: unknown) {
  if (jsonFlag) {
    console.log(JSON.stringify(data));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function nsQuery(): string {
  return ns ? `?ns=${encodeURIComponent(ns)}` : "";
}

switch (cmd) {
  case "get": {
    const [key] = args;
    if (!key) {
      console.error("Usage: dunena get <key> [--ns=namespace]");
      process.exit(1);
    }
    output(await request("GET", `/cache/${encodeURIComponent(key)}${nsQuery()}`));
    break;
  }

  case "set": {
    const [key, value, ttlStr] = args;
    if (!key || value === undefined) {
      console.error("Usage: dunena set <key> <value> [ttl_ms] [--ns=namespace]");
      process.exit(1);
    }
    const body: Record<string, unknown> = { value };
    if (ttlStr) body.ttl = parseInt(ttlStr, 10);
    output(await request("POST", `/cache/${encodeURIComponent(key)}${nsQuery()}`, body));
    break;
  }

  case "del":
  case "delete": {
    const [key] = args;
    if (!key) {
      console.error("Usage: dunena del <key> [--ns=namespace]");
      process.exit(1);
    }
    output(await request("DELETE", `/cache/${encodeURIComponent(key)}${nsQuery()}`));
    break;
  }

  case "mget": {
    if (args.length === 0) {
      console.error("Usage: dunena mget <key1> <key2> ... [--ns=namespace]");
      process.exit(1);
    }
    output(await request("POST", "/cache", { action: "mget", keys: args, ns }));
    break;
  }

  case "mset": {
    // Parse key=value pairs: dunena mset k1=v1 k2=v2
    if (args.length === 0) {
      console.error("Usage: dunena mset <key=value> [key=value ...] [--ns=namespace]");
      process.exit(1);
    }
    const entries: Array<{ key: string; value: string }> = [];
    for (const arg of args) {
      const eq = arg.indexOf("=");
      if (eq < 1) {
        console.error(`Invalid entry "${arg}". Use key=value format.`);
        process.exit(1);
      }
      entries.push({ key: arg.slice(0, eq), value: arg.slice(eq + 1) });
    }
    output(await request("POST", "/cache", { action: "mset", entries, ns }));
    break;
  }

  case "keys":
  case "scan": {
    const pattern = args[0] ?? "*";
    const qs = new URLSearchParams();
    qs.set("pattern", pattern);
    if (ns) qs.set("ns", ns);
    output(await request("GET", `/keys?${qs.toString()}`));
    break;
  }

  case "stats":
    output(await request("GET", "/stats"));
    break;

  case "history":
    output(await request("GET", "/stats/history"));
    break;

  case "flush":
    output(await request("POST", "/flush"));
    break;

  case "info":
    output(await request("GET", "/info"));
    break;

  case "health":
    output(await request("GET", "/health"));
    break;

  case "bench":
  case "benchmark": {
    const count = parseInt(args[0] ?? "1000", 10);
    console.log(`Running benchmark: ${count} SET + ${count} GET operations…\n`);

    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      await request("POST", `/cache/bench-${i}`, {
        value: `value-${i}-${"x".repeat(64)}`,
      });
    }
    const setTime = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < count; i++) {
      await request("GET", `/cache/bench-${i}`);
    }
    const getTime = performance.now() - t1;

    console.log(`SET: ${count} ops in ${setTime.toFixed(1)} ms  (${(count / (setTime / 1000)).toFixed(0)} ops/s)`);
    console.log(`GET: ${count} ops in ${getTime.toFixed(1)} ms  (${(count / (getTime / 1000)).toFixed(0)} ops/s)`);
    console.log(`\nTotal: ${(setTime + getTime).toFixed(1)} ms`);

    // Cleanup
    for (let i = 0; i < count; i++) {
      await request("DELETE", `/cache/bench-${i}`);
    }
    break;
  }

  // ── Database commands ──────────────────────────────────

  case "db-get": {
    const [key] = args;
    if (!key) {
      console.error("Usage: dunena db-get <key> [--ns=namespace]");
      process.exit(1);
    }
    const qs = ns ? `?ns=${encodeURIComponent(ns)}` : "";
    output(await request("GET", `/db/${encodeURIComponent(key)}${qs}`));
    break;
  }

  case "db-set": {
    const [key, value, ttlStr] = args;
    if (!key || value === undefined) {
      console.error("Usage: dunena db-set <key> <value> [ttl_ms] [--ns=namespace]");
      process.exit(1);
    }
    const body: Record<string, unknown> = { value };
    if (ttlStr) body.ttl = parseInt(ttlStr, 10);
    if (ns) body.ns = ns;
    output(await request("POST", `/db/${encodeURIComponent(key)}`, body));
    break;
  }

  case "db-del": {
    const [key] = args;
    if (!key) {
      console.error("Usage: dunena db-del <key> [--ns=namespace]");
      process.exit(1);
    }
    const qs = ns ? `?ns=${encodeURIComponent(ns)}` : "";
    output(await request("DELETE", `/db/${encodeURIComponent(key)}${qs}`));
    break;
  }

  case "db-keys": {
    const pattern = args[0] ?? "*";
    const qs = new URLSearchParams();
    qs.set("pattern", pattern);
    if (ns) qs.set("ns", ns);
    output(await request("GET", `/db-keys?${qs.toString()}`));
    break;
  }

  case "db-stats":
    output(await request("GET", "/db-stats"));
    break;

  case "db-clear":
    output(await request("POST", `/db-clear${ns ? `?ns=${encodeURIComponent(ns)}` : ""}`));
    break;

  case "db-purge":
    output(await request("POST", "/db-purge"));
    break;

  case "qc-get": {
    const [key] = args;
    if (!key) {
      console.error("Usage: dunena qc-get <key>");
      process.exit(1);
    }
    output(await request("GET", `/query-cache/${encodeURIComponent(key)}`));
    break;
  }

  case "qc-set": {
    const [key, dataStr] = args;
    if (!key || !dataStr) {
      console.error("Usage: dunena qc-set <key> <json_data> [--tags=a,b]");
      process.exit(1);
    }
    let data: unknown;
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = dataStr;
    }
    output(await request("POST", "/query-cache", { key, data }));
    break;
  }

  case "qc-invalidate": {
    if (args.length === 0) {
      console.error("Usage: dunena qc-invalidate <tag1> [tag2] ...");
      process.exit(1);
    }
    output(await request("POST", "/query-cache/invalidate", { tags: args }));
    break;
  }

  case "qc-stats":
    output(await request("GET", "/query-cache/stats"));
    break;

  case "qc-clear":
    output(await request("POST", "/query-cache/clear"));
    break;

  case "db-proxy-list":
    output(await request("GET", "/db-proxy/connectors"));
    break;

  case "db-proxy-register": {
    const [name, type, connStr] = args;
    if (!name || !type || !connStr) {
      console.error("Usage: dunena db-proxy-register <name> <type> <connectionString>");
      console.error("       Types: postgresql, mysql, http");
      process.exit(1);
    }
    output(await request("POST", "/db-proxy/register", {
      name, type, connectionString: connStr,
    }));
    break;
  }

  case "db-proxy-query": {
    const [connector, query] = args;
    if (!connector || !query) {
      console.error("Usage: dunena db-proxy-query <connector> <query>");
      process.exit(1);
    }
    output(await request("POST", "/db-proxy/query", { connector, query }));
    break;
  }

  case "doctor": {
    console.log("\n  Dunena Doctor — Environment Check\n");

    // 1. Bun version
    const bunVer = typeof Bun !== "undefined" ? Bun.version : null;
    if (bunVer) {
      console.log(`  ✅ Bun runtime:    v${bunVer}`);
    } else {
      console.log("  ❌ Bun runtime:    Not detected (Dunena requires Bun)");
    }

    // 2. Zig availability
    try {
      const zigProc = Bun.spawnSync(["zig", "version"]);
      const zigVer = new TextDecoder().decode(zigProc.stdout).trim();
      if (zigVer) {
        console.log(`  ✅ Zig compiler:   v${zigVer}`);
      } else {
        console.log("  ⚠️  Zig compiler:   Not found (needed for source builds only)");
      }
    } catch {
      console.log("  ⚠️  Zig compiler:   Not found (needed for source builds only)");
    }

    // 3. Native library
    const { existsSync } = await import("fs");
    const { resolve } = await import("path");
    const zigOutLib = resolve(process.cwd(), "zig/zig-out/lib");
    const zigOutBin = resolve(process.cwd(), "zig/zig-out/bin");
    const libExtensions = [".dll", ".so", ".dylib"];
    let libFound = false;
    let libPath = "";

    for (const dir of [zigOutLib, zigOutBin]) {
      if (existsSync(dir)) {
        try {
          const entries = (await import("fs")).readdirSync(dir);
          for (const entry of entries) {
            if (libExtensions.some(ext => entry.endsWith(ext))) {
              libFound = true;
              libPath = `${dir}/${entry}`;
              break;
            }
          }
        } catch { /* ignore */ }
      }
      if (libFound) break;
    }

    if (libFound) {
      console.log(`  ✅ Native library: ${libPath}`);
    } else {
      console.log("  ❌ Native library: Not found — run 'bun run build:zig' to build");
    }

    // 4. Data directory
    const dataDir = resolve(process.cwd(), "data");
    if (existsSync(dataDir)) {
      console.log(`  ✅ Data directory: ${dataDir}`);
    } else {
      console.log(`  ⚠️  Data directory: ${dataDir} (will be created on first run)`);
    }

    // 5. Server reachability
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(`  ✅ Server:         Running at ${BASE}`);
      } else {
        console.log(`  ⚠️  Server:         Responded with status ${res.status} at ${BASE}`);
      }
    } catch {
      console.log(`  ℹ️  Server:         Not running at ${BASE}`);
    }

    console.log("\n  Done. Fix any ❌ items above before starting.\n");
    break;
  }

  default:
    console.log(`
  Dunena CLI — High-Performance Cache Engine

  Usage:  bun run cli <command> [args] [flags]

  Server Commands:
    doctor                          Check environment setup

  Cache Commands:
    get   <key>                     Get a cached value
    set   <key> <value> [ttl_ms]    Set a cached value
    del   <key>                     Delete a cached value
    mget  <key1> <key2> ...         Get multiple values
    mset  <key=val> [key=val ...]   Set multiple key=value pairs
    keys  [pattern]                 Scan keys (supports * and ? wildcards)
    stats                           Show cache statistics
    history                         Show analytics history
    flush                           Clear all cached data
    info                            Show server info
    health                          Health check
    bench [count]                   Run benchmark (default: 1000)

  Database Commands:
    db-get   <key>                  Get a durable DB entry
    db-set   <key> <value> [ttl]    Store a durable DB entry
    db-del   <key>                  Delete a DB entry
    db-keys  [pattern]              List DB keys
    db-stats                        Show database statistics
    db-clear                        Clear all DB entries
    db-purge                        Purge expired DB entries

  Query Cache Commands:
    qc-get   <key>                  Get a cached query result
    qc-set   <key> <json>           Cache a query result
    qc-invalidate <tag1> [tag2]     Invalidate by tags
    qc-stats                        Query cache statistics
    qc-clear                        Clear query cache

  Database Proxy Commands:
    db-proxy-list                   List registered connectors
    db-proxy-register <n> <t> <url> Register a connector
    db-proxy-query <conn> <query>   Execute a proxied query

  Flags:
    --ns=<namespace>    Scope operations to a namespace
    --json              Output compact JSON (for scripting)

  Environment:
    DUNENA_URL          Server URL (default: http://localhost:3000)
    DUNENA_AUTH_TOKEN    Bearer token for authentication

  Install & Run:
    See INSTALL.md for setup instructions.
    Run 'bun run cli -- doctor' to check your environment.
`);
}
