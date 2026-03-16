#!/usr/bin/env bun
// ── Dunena Unified CLI Entrypoint ───────────────────────────
// Routes server management commands locally and delegates
// cache/db operations to the CLI client.
export {};

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "start": {
    // Start the server (production mode)
    const { startServer } = await import("@dunena/platform");
    startServer();
    break;
  }

  case "dev": {
    // Start the server in dev/watch mode
    // Spawn bun with --watch flag
    const proc = Bun.spawn(
      ["bun", "run", "--watch", "apps/server/src/index.ts"],
      { stdio: ["inherit", "inherit", "inherit"] }
    );
    await proc.exited;
    break;
  }

  default: {
    // Delegate everything else to the CLI client
    // Re-set argv so the CLI sees the original command
    process.argv = [process.argv[0], process.argv[1], cmd, ...rest].filter(Boolean);
    await import("@dunena/platform/cli");
  }
}
