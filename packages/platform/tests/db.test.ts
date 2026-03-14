// ── Database Integration Tests ──────────────────────────────
// Tests for SQLite adapter, query cache, database proxy, and
// all related HTTP endpoints.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../src/server/app";
import type { AppConfig } from "../src/types";

const TEST_PORT = 19877; // different port from api.test.ts

const testConfig: AppConfig = {
  cache: {
    maxEntries: 1000,
    enableBloomFilter: true,
    bloomFilterSize: 10_000,
    bloomFilterHashes: 5,
  },
  server: {
    port: TEST_PORT,
    host: "127.0.0.1",
    enableWebSocket: false,
    enableDashboard: false,
    rateLimit: { windowMs: 60_000, maxRequests: 10_000 },
    cors: { origins: ["*"], methods: ["GET", "POST", "PUT", "DELETE"] },
  },
  persistence: {
    enabled: false,
    filePath: "./data/test-db-snapshot.json",
    intervalMs: 0,
    saveOnShutdown: false,
  },
  database: {
    enabled: true,
    sqlitePath: ":memory:",
    queryCacheTTL: 5_000,
    purgeIntervalMs: 0,
  },
  log: { level: "error", format: "text" },
};

const BASE = `http://127.0.0.1:${TEST_PORT}`;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp(testConfig);
});

afterAll(async () => {
  if (app.sqliteAdapter) await app.sqliteAdapter.close();
  app.cacheService.destroy();
  app.server.stop();
});

// ── SQLite KV CRUD via HTTP ────────────────────────────────

describe("SQLite KV CRUD", () => {
  it("POST then GET a key", async () => {
    const setRes = await fetch(`${BASE}/db/greeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "hello world" }),
    });
    expect(setRes.status).toBe(201);
    const setBody = await setRes.json() as { ok: boolean };
    expect(setBody.ok).toBe(true);

    const getRes = await fetch(`${BASE}/db/greeting`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { key: string; value: string; namespace: string; tags: string[] };
    expect(getBody.key).toBe("greeting");
    expect(getBody.value).toBe("hello world");
    expect(getBody.namespace).toBe("");
    expect(Array.isArray(getBody.tags)).toBe(true);
  });

  it("GET missing key returns 404", async () => {
    const res = await fetch(`${BASE}/db/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("DELETE a key", async () => {
    await fetch(`${BASE}/db/to-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "temp" }),
    });
    const delRes = await fetch(`${BASE}/db/to-delete`, { method: "DELETE" });
    const body = await delRes.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);

    const getRes = await fetch(`${BASE}/db/to-delete`);
    expect(getRes.status).toBe(404);
  });

  it("respects namespace isolation", async () => {
    await fetch(`${BASE}/db/ns-key?ns=alpha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "alpha-val" }),
    });
    await fetch(`${BASE}/db/ns-key?ns=beta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "beta-val" }),
    });

    const alpha = await fetch(`${BASE}/db/ns-key?ns=alpha`);
    const alphaBody = await alpha.json() as { value: string };
    expect(alphaBody.value).toBe("alpha-val");

    const beta = await fetch(`${BASE}/db/ns-key?ns=beta`);
    const betaBody = await beta.json() as { value: string };
    expect(betaBody.value).toBe("beta-val");
  });

  it("stores and retrieves tags", async () => {
    await fetch(`${BASE}/db/tagged-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "data", tags: ["users", "accounts"] }),
    });

    const res = await fetch(`${BASE}/db/tagged-key`);
    const body = await res.json() as { tags: string[] };
    expect(body.tags).toContain("users");
    expect(body.tags).toContain("accounts");
  });

  it("updates an existing key with new value and tags", async () => {
    await fetch(`${BASE}/db/updatable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "v1", tags: ["old"] }),
    });
    await fetch(`${BASE}/db/updatable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "v2", tags: ["new"] }),
    });

    const res = await fetch(`${BASE}/db/updatable`);
    const body = await res.json() as { value: string; tags: string[] };
    expect(body.value).toBe("v2");
    expect(body.tags).toContain("new");
    expect(body.tags).not.toContain("old");
  });
});

// ── SQLite Batch Operations ────────────────────────────────

describe("SQLite Batch", () => {
  it("mset and mget", async () => {
    const msetRes = await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mset",
        entries: [
          { key: "b1", value: "one" },
          { key: "b2", value: "two" },
          { key: "b3", value: "three" },
        ],
      }),
    });
    const msetBody = await msetRes.json() as { stored: number };
    expect(msetBody.stored).toBe(3);

    const mgetRes = await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mget", keys: ["b1", "b2", "b3", "b4"] }),
    });
    const mgetBody = await mgetRes.json() as { result: Record<string, unknown> };
    expect(mgetBody.result.b1).not.toBeNull();
    expect(mgetBody.result.b4).toBeNull();
  });

  it("mdelete removes multiple keys", async () => {
    await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mset",
        entries: [
          { key: "d1", value: "x" },
          { key: "d2", value: "y" },
        ],
      }),
    });
    const res = await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mdelete", keys: ["d1", "d2", "d3"] }),
    });
    const body = await res.json() as { deleted: number };
    expect(body.deleted).toBe(2);
  });

  it("query filters by prefix and tags", async () => {
    await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mset",
        entries: [
          { key: "user:1", value: "Alice", tags: ["users"] },
          { key: "user:2", value: "Bob", tags: ["users"] },
          { key: "order:1", value: "item", tags: ["orders"] },
        ],
      }),
    });

    const res = await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "query", pattern: "user:", ns: "" }),
    });
    const body = await res.json() as { entries: unknown[]; count: number };
    expect(body.count).toBe(2);
  });

  it("deleteByTags removes entries with matching tags", async () => {
    // Use a dedicated namespace for isolation
    const ns = "tag-test";
    await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mset",
        ns,
        entries: [
          { key: "tag-a", value: "x", tags: ["group-a"] },
          { key: "tag-b", value: "y", tags: ["group-a"] },
          { key: "tag-c", value: "z", tags: ["group-b"] },
        ],
      }),
    });

    const res = await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteByTags", tags: ["group-a"], ns }),
    });
    const body = await res.json() as { deleted: number };
    expect(body.deleted).toBe(2);

    // group-b should still exist
    const check = await fetch(`${BASE}/db/tag-c?ns=${ns}`);
    expect(check.status).toBe(200);
  });

  it("rejects unknown batch action", async () => {
    const res = await fetch(`${BASE}/db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bloop" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── SQLite Management ──────────────────────────────────────

describe("SQLite Management", () => {
  it("GET /db-stats returns storage statistics", async () => {
    const res = await fetch(`${BASE}/db-stats`);
    expect(res.status).toBe(200);
    const body = await res.json() as { backend: string; totalEntries: number; dbSizeBytes: number };
    expect(body.backend).toBe("sqlite");
    expect(typeof body.totalEntries).toBe("number");
    expect(typeof body.dbSizeBytes).toBe("number");
  });

  it("GET /db-keys lists keys with optional pattern", async () => {
    // Seed
    await fetch(`${BASE}/db/list-a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "a" }),
    });
    await fetch(`${BASE}/db/list-b`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "b" }),
    });

    const res = await fetch(`${BASE}/db-keys?pattern=list-*`);
    const body = await res.json() as { keys: string[]; count: number };
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(body.keys).toContain("list-a");
    expect(body.keys).toContain("list-b");
  });

  it("POST /db-clear clears the database", async () => {
    const res = await fetch(`${BASE}/db-clear`, { method: "POST" });
    const body = await res.json() as { cleared: boolean };
    expect(body.cleared).toBe(true);

    const stats = await (await fetch(`${BASE}/db-stats`)).json() as { totalEntries: number };
    expect(stats.totalEntries).toBe(0);
  });

  it("POST /db-purge removes expired entries", async () => {
    const res = await fetch(`${BASE}/db-purge`, { method: "POST" });
    const body = await res.json() as { purged: number };
    expect(typeof body.purged).toBe("number");
  });
});

// ── SQLite TTL Expiry ──────────────────────────────────────

describe("SQLite TTL", () => {
  it("expired entries are not returned", async () => {
    // Set with 100ms TTL
    await fetch(`${BASE}/db/ttl-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "short-lived", ttl: 100 }),
    });

    // Verify it exists now
    const before = await fetch(`${BASE}/db/ttl-key`);
    expect(before.status).toBe(200);

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 150));

    // Should be gone (lazy expiration on read)
    const after = await fetch(`${BASE}/db/ttl-key`);
    expect(after.status).toBe(404);
  });
});

// ── Query Cache ────────────────────────────────────────────

describe("Query Cache", () => {
  it("caches and retrieves query results", async () => {
    const setRes = await fetch(`${BASE}/query-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "users-list",
        data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
        tags: ["users"],
      }),
    });
    expect(setRes.status).toBe(201);

    const getRes = await fetch(`${BASE}/query-cache/users-list`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { key: string; data: unknown; cached: boolean };
    expect(body.cached).toBe(true);
    expect(body.key).toBe("users-list");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 404 for cache miss", async () => {
    const res = await fetch(`${BASE}/query-cache/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("invalidates by key", async () => {
    await fetch(`${BASE}/query-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "to-inv", data: { foo: "bar" } }),
    });

    const invRes = await fetch(`${BASE}/query-cache/invalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "to-inv" }),
    });
    const invBody = await invRes.json() as { invalidated: number };
    expect(invBody.invalidated).toBe(1);

    const check = await fetch(`${BASE}/query-cache/to-inv`);
    expect(check.status).toBe(404);
  });

  it("invalidates by tags", async () => {
    // Clear first to isolate from previous tests
    await fetch(`${BASE}/query-cache/clear`, { method: "POST" });

    await fetch(`${BASE}/query-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "order-q1", data: { total: 100 }, tags: ["orders"] }),
    });
    await fetch(`${BASE}/query-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "order-q2", data: { total: 200 }, tags: ["orders"] }),
    });

    const invRes = await fetch(`${BASE}/query-cache/invalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["orders"] }),
    });
    const invBody = await invRes.json() as { invalidated: number };
    expect(invBody.invalidated).toBe(2);

    const check = await fetch(`${BASE}/query-cache/order-q1`);
    expect(check.status).toBe(404);
  });

  it("GET /query-cache/stats returns stats", async () => {
    const res = await fetch(`${BASE}/query-cache/stats`);
    expect(res.status).toBe(200);
    const body = await res.json() as { hits: number; misses: number; hitRate: number };
    expect(typeof body.hits).toBe("number");
    expect(typeof body.misses).toBe("number");
    expect(typeof body.hitRate).toBe("number");
  });

  it("POST /query-cache/clear clears query cache", async () => {
    await fetch(`${BASE}/query-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "to-clear", data: {} }),
    });
    const clearRes = await fetch(`${BASE}/query-cache/clear`, { method: "POST" });
    const body = await clearRes.json() as { cleared: boolean };
    expect(body.cleared).toBe(true);
  });

  it("validates required fields", async () => {
    const noKey = await fetch(`${BASE}/query-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "x" }),
    });
    expect(noKey.status).toBe(400);

    const noData = await fetch(`${BASE}/query-cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "k" }),
    });
    expect(noData.status).toBe(400);
  });
});

// ── Database Proxy ─────────────────────────────────────────

describe("Database Proxy", () => {
  it("GET /db-proxy/connectors lists empty initially", async () => {
    const res = await fetch(`${BASE}/db-proxy/connectors`);
    expect(res.status).toBe(200);
    const body = await res.json() as { connectors: unknown[] };
    expect(Array.isArray(body.connectors)).toBe(true);
  });

  it("registers and lists a connector", async () => {
    const regRes = await fetch(`${BASE}/db-proxy/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "http",
        name: "test-api",
        connectionString: "http://example.com/api",
        readOnly: true,
      }),
    });
    expect(regRes.status).toBe(201);

    const listRes = await fetch(`${BASE}/db-proxy/connectors`);
    const body = await listRes.json() as { connectors: Array<{ name: string; type: string; readOnly: boolean }> };
    expect(body.connectors.some((c) => c.name === "test-api")).toBe(true);
    expect(body.connectors.find((c) => c.name === "test-api")?.readOnly).toBe(true);
  });

  it("rejects duplicate connector registration", async () => {
    const res = await fetch(`${BASE}/db-proxy/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "http",
        name: "test-api",
        connectionString: "http://example.com/api",
      }),
    });
    expect(res.status).toBe(409);
  });

  it("validates registration fields", async () => {
    const res = await fetch(`${BASE}/db-proxy/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("validates connector type", async () => {
    const res = await fetch(`${BASE}/db-proxy/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad", type: "redis", connectionString: "redis://localhost" }),
    });
    expect(res.status).toBe(400);
  });

  it("unregisters a connector", async () => {
    const res = await fetch(`${BASE}/db-proxy/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-api" }),
    });
    const body = await res.json() as { unregistered: boolean };
    expect(body.unregistered).toBe(true);
  });

  it("query with unknown connector returns 502", async () => {
    const res = await fetch(`${BASE}/db-proxy/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connector: "nonexistent", query: "SELECT 1" }),
    });
    expect(res.status).toBe(502);
  });

  it("invalidate validates tags", async () => {
    const res = await fetch(`${BASE}/db-proxy/invalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: [] }),
    });
    expect(res.status).toBe(400);
  });
});

// ── /info includes database flag ───────────────────────────

describe("Info endpoint", () => {
  it("includes database status", async () => {
    const res = await fetch(`${BASE}/info`);
    const body = await res.json() as { database: boolean };
    expect(body.database).toBe(true);
  });
});
