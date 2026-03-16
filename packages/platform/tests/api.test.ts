// ── Integration Tests ──────────────────────────────────────
// These tests spin up a real Dunena server and verify the HTTP API.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../src/server/app";
import type { AppConfig } from "../src/types";

const TEST_PORT = 19876;

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
    enableWebSocket: true,
    enableDashboard: false,
    rateLimit: { windowMs: 60_000, maxRequests: 10_000 },
    cors: { origins: ["*"], methods: ["GET", "POST", "PUT", "DELETE"] },
  },
  persistence: {
    enabled: false,
    filePath: "./data/test-snapshot.json",
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

interface BodyResponse {
  [key: string]: any;
  status?: string;
  key?: string;
  value?: string;
  deleted?: boolean;
  stored?: number;
  result?: Record<string, string | null>;
  cache?: { hits: number; misses: number; hitRate: number };
  name?: string;
  version?: string;
}

beforeAll(() => {
  app = createApp(testConfig);
});

afterAll(() => {
  app.cacheService.destroy();
  app.server.stop();
});

// ── Health ─────────────────────────────────────────────────

describe("Health", () => {
  it("GET /health returns ok", async () => {
    const res = await fetch(`${BASE}/health`);
    const body = (await res.json()) as BodyResponse;
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});

// ── Cache CRUD ─────────────────────────────────────────────

describe("Cache CRUD", () => {
  it("POST then GET a key", async () => {
    const setRes = await fetch(`${BASE}/cache/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "world" }),
    });
    expect(setRes.status).toBe(201);

    const getRes = await fetch(`${BASE}/cache/hello`);

    const body = (await getRes.json()) as BodyResponse;

    expect(body.key).toBe("hello");
    expect(body.value).toBe("world");
  });

  it("GET missing key returns 404", async () => {
    const res = await fetch(`${BASE}/cache/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("DELETE a key", async () => {
    await fetch(`${BASE}/cache/to-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "temp" }),
    });
    const delRes = await fetch(`${BASE}/cache/to-delete`, { method: "DELETE" });
    const body = (await delRes.json()) as BodyResponse;
    expect(body.deleted).toBe(true);

    const getRes = await fetch(`${BASE}/cache/to-delete`);
    expect(getRes.status).toBe(404);
  });

  it("update an existing key", async () => {
    await fetch(`${BASE}/cache/upd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "v1" }),
    });
    await fetch(`${BASE}/cache/upd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "v2" }),
    });
    const res = await fetch(`${BASE}/cache/upd`);
    const body = (await res.json()) as BodyResponse;
    expect(body.value).toBe("v2");
  });
});

// ── Batch ──────────────────────────────────────────────────

describe("Batch", () => {
  it("mset then mget", async () => {
    const msetRes = await fetch(`${BASE}/cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mset",
        entries: [
          { key: "m1", value: "a" },
          { key: "m2", value: "b" },
          { key: "m3", value: "c" },
        ],
      }),
    });
    const msetBody = (await msetRes.json()) as BodyResponse;
    expect(msetBody.stored).toBe(3);

    const mgetRes = await fetch(`${BASE}/cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mget", keys: ["m1", "m2", "m3", "m4"] }),
    });
    const mgetBody = (await mgetRes.json()) as BodyResponse;

    expect(mgetBody.result!.m1).toBe("a");
    expect(mgetBody.result!.m4).toBeNull();
  });
});

// ── Stats & Info ───────────────────────────────────────────

describe("Stats", () => {
  it("GET /stats returns cache stats", async () => {
    const res = await fetch(`${BASE}/stats`);
    const body = (await res.json()) as BodyResponse;
    expect(body.cache).toBeDefined();
    expect(typeof body.cache!.hits).toBe("number");
    expect(typeof body.cache!.hitRate).toBe("number");
  });

  it("GET /info returns server info", async () => {
    const res = await fetch(`${BASE}/info`);
    const body = (await res.json()) as BodyResponse;
    expect(body.name).toBe("dunena");
    expect(body.version).toBe("0.2.0");
  });
});

// ── Flush ──────────────────────────────────────────────────

describe("Flush", () => {
  it("POST /flush clears the cache", async () => {
    // Seed some data
    await fetch(`${BASE}/cache/f1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x" }),
    });

    const flushRes = await fetch(`${BASE}/flush`, { method: "POST" });
    const body = (await flushRes.json()) as BodyResponse;
    expect(body.flushed).toBe(true);

    const getRes = await fetch(`${BASE}/cache/f1`);
    expect(getRes.status).toBe(404);
  });
});

// ── Validation ─────────────────────────────────────────────

describe("Validation", () => {
  it("rejects empty key", async () => {
    const res = await fetch(`${BASE}/cache/%00`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-string value", async () => {
    const res = await fetch(`${BASE}/cache/test-val`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: 12345 }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Namespaces ─────────────────────────────────────────────

describe("Namespaces", () => {
  it("isolates keys by namespace", async () => {
    await fetch(`${BASE}/cache/ns-key?ns=alpha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "alpha-val" }),
    });
    await fetch(`${BASE}/cache/ns-key?ns=beta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "beta-val" }),
    });

    const alphaRes = await fetch(`${BASE}/cache/ns-key?ns=alpha`);
    const alphaBody = (await alphaRes.json()) as BodyResponse;
    expect(alphaBody.value).toBe("alpha-val");

    const betaRes = await fetch(`${BASE}/cache/ns-key?ns=beta`);
    const betaBody = (await betaRes.json()) as BodyResponse;
    expect(betaBody.value).toBe("beta-val");
  });

  it("namespace keys are invisible without namespace", async () => {
    await fetch(`${BASE}/cache/ns-only?ns=secret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "hidden" }),
    });

    const res = await fetch(`${BASE}/cache/ns-only`);
    expect(res.status).toBe(404);
  });

  it("DELETE respects namespace", async () => {
    await fetch(`${BASE}/cache/ns-del?ns=zone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "temp" }),
    });
    const delRes = await fetch(`${BASE}/cache/ns-del?ns=zone`, { method: "DELETE" });
    const body = (await delRes.json()) as BodyResponse;
    expect(body.deleted).toBe(true);

    const getRes = await fetch(`${BASE}/cache/ns-del?ns=zone`);
    expect(getRes.status).toBe(404);
  });
});

// ── TTL ────────────────────────────────────────────────────

describe("TTL", () => {
  it("key expires after TTL", async () => {
    await fetch(`${BASE}/cache/ttl-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "temp", ttl: 200 }),
    });

    // Key should exist immediately
    const before = await fetch(`${BASE}/cache/ttl-key`);
    expect(before.status).toBe(200);

    // Wait for expiry
    await Bun.sleep(350);

    const after = await fetch(`${BASE}/cache/ttl-key`);
    expect(after.status).toBe(404);
  });

  it("rejects negative TTL", async () => {
    const res = await fetch(`${BASE}/cache/ttl-neg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x", ttl: -100 }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Prometheus Metrics ─────────────────────────────────────

describe("Metrics", () => {
  it("GET /metrics returns Prometheus format", async () => {
    const res = await fetch(`${BASE}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");

    const text = await res.text();
    expect(text).toContain("dunena_cache_hits_total");
    expect(text).toContain("dunena_cache_entries");
    expect(text).toContain("dunena_cache_hit_rate");
    expect(text).toContain("dunena_uptime_seconds");
    expect(text).toContain("dunena_request_latency_ms");
  });
});

// ── Key Scanning ───────────────────────────────────────────

describe("Key Scanning", () => {
  it("GET /keys returns stored keys", async () => {
    // Seed data
    await fetch(`${BASE}/cache/scan-a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "1" }),
    });
    await fetch(`${BASE}/cache/scan-b`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "2" }),
    });

    const res = await fetch(`${BASE}/keys?pattern=scan-*`);
    const body = (await res.json()) as BodyResponse;
    expect(res.status).toBe(200);
    expect(body.keys).toContain("scan-a");
    expect(body.keys).toContain("scan-b");
  });

  it("filters by namespace", async () => {
    await fetch(`${BASE}/cache/nk1?ns=scanns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x" }),
    });
    await fetch(`${BASE}/cache/nk2?ns=other`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "y" }),
    });

    const res = await fetch(`${BASE}/keys?ns=scanns`);
    const body = (await res.json()) as BodyResponse;
    expect(body.keys).toContain("nk1");
    expect(body.keys).not.toContain("nk2");
  });

  it("returns empty array for no matches", async () => {
    const res = await fetch(`${BASE}/keys?pattern=nonexistent-*`);
    const body = (await res.json()) as BodyResponse;
    expect(body.keys).toEqual([]);
    expect(body.cursor).toBe(0);
  });
});

// ── WebSocket ──────────────────────────────────────────────

describe("WebSocket", () => {
  function connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);
      ws.onopen = () => {
        // Drain the "connected" message before resolving
        ws.onmessage = () => resolve(ws);
      };
      ws.onerror = (e) => reject(e);
    });
  }

  function sendAndReceive(ws: WebSocket, msg: object): Promise<any> {
    return new Promise((resolve) => {
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data as string);
        // Skip pub/sub event broadcasts, wait for a direct response
        if (data.type === "result" || data.type === "error" || data.type === "pong" || data.type === "subscribed") {
          resolve(data);
        }
      };
      ws.send(JSON.stringify(msg));
    });
  }

  it("connects and receives connected message", async () => {
    const ws = await connectWs();
    const pong = await sendAndReceive(ws, { type: "ping" });
    expect(pong.type).toBe("pong");
    expect(pong.timestamp).toBeGreaterThan(0);
    ws.close();
  });

  it("set and get via WebSocket", async () => {
    const ws = await connectWs();

    const setResult = await sendAndReceive(ws, { type: "set", key: "ws-k", value: "ws-v" });
    expect(setResult.type).toBe("result");
    expect(setResult.data.ok).toBe(true);

    const getResult = await sendAndReceive(ws, { type: "get", key: "ws-k" });
    expect(getResult.type).toBe("result");
    expect(getResult.data.value).toBe("ws-v");
    ws.close();
  });

  it("del via WebSocket", async () => {
    const ws = await connectWs();

    await sendAndReceive(ws, { type: "set", key: "ws-del", value: "temp" });
    const delResult = await sendAndReceive(ws, { type: "del", key: "ws-del" });
    expect(delResult.type).toBe("result");
    expect(delResult.data.deleted).toBe(true);
    ws.close();
  });

  it("set with namespace and TTL via WebSocket", async () => {
    const ws = await connectWs();

    const setResult = await sendAndReceive(ws, {
      type: "set", key: "ws-ns", value: "nsval", ns: "myns", ttl: 5000,
    });
    expect(setResult.data.ok).toBe(true);

    // Verify via HTTP that it's in the namespace
    const httpRes = await fetch(`${BASE}/cache/ws-ns?ns=myns`);
    const httpBody = (await httpRes.json()) as BodyResponse;
    expect(httpBody.value).toBe("nsval");
    ws.close();
  });

  it("mset and mget via WebSocket", async () => {
    const ws = await connectWs();

    const msetResult = await sendAndReceive(ws, {
      type: "mset",
      entries: [
        { key: "wm1", value: "a" },
        { key: "wm2", value: "b" },
      ],
    });
    expect(msetResult.data.stored).toBe(2);

    const mgetResult = await sendAndReceive(ws, {
      type: "mget",
      keys: ["wm1", "wm2", "wm3"],
    });
    expect(mgetResult.data.result.wm1).toBe("a");
    expect(mgetResult.data.result.wm2).toBe("b");
    expect(mgetResult.data.result.wm3).toBeNull();
    ws.close();
  });

  it("returns error for invalid key via WebSocket", async () => {
    const ws = await connectWs();

    const result = await sendAndReceive(ws, { type: "get", key: "\x00" });
    expect(result.type).toBe("error");
    ws.close();
  });
});

// ── Security ───────────────────────────────────────────────

describe("Security", () => {
  it("blocks path traversal in docs route", async () => {
    const res = await fetch(`${BASE}/docs/../package.json`);
    // Should return 403 or 404 — never 200 with file contents
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).not.toContain('"dunena"');
  });

  it("returns proper CORS headers on API responses", async () => {
    const res = await fetch(`${BASE}/health`);
    const origin = res.headers.get("access-control-allow-origin");
    expect(origin).toBe("*");
  });

  it("OPTIONS preflight returns 204 with CORS", async () => {
    const res = await fetch(`${BASE}/cache/test`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    const methods = res.headers.get("access-control-allow-methods");
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
  });
});

// ── Namespace Key Isolation ────────────────────────────────

describe("Namespace key isolation", () => {
  it("keys with colons don't collide with namespaced keys", async () => {
    // Set key "b" in namespace "a"
    await fetch(`${BASE}/cache/b?ns=a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "namespaced-val" }),
    });

    // Set key "a:b" without namespace
    await fetch(`${BASE}/cache/a:b`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "plain-val" }),
    });

    // They should be different entries
    const nsRes = await fetch(`${BASE}/cache/b?ns=a`);
    const nsBody = (await nsRes.json()) as BodyResponse;
    expect(nsBody.value).toBe("namespaced-val");

    const plainRes = await fetch(`${BASE}/cache/a:b`);
    const plainBody = (await plainRes.json()) as BodyResponse;
    expect(plainBody.value).toBe("plain-val");
  });
});

// ── Prometheus Metrics Format ──────────────────────────────

describe("Prometheus metrics format", () => {
  it("uses summary type for latency", async () => {
    const res = await fetch(`${BASE}/metrics`);
    const text = await res.text();
    expect(text).toContain("# TYPE dunena_request_latency_ms summary");
    expect(text).toContain('dunena_request_latency_ms{quantile="0.5"}');
    expect(text).toContain('dunena_request_latency_ms{quantile="0.99"}');
    expect(text).toContain("dunena_request_latency_ms_count");
  });

  it("contains all counter and gauge metrics", async () => {
    const res = await fetch(`${BASE}/metrics`);
    const text = await res.text();
    expect(text).toContain("dunena_cache_hits_total");
    expect(text).toContain("dunena_cache_entries");
    expect(text).toContain("dunena_uptime_seconds");
  });
});

// ── Snapshot Endpoint ──────────────────────────────────────

describe("Snapshot", () => {
  it("POST /snapshot returns saved status", async () => {
    const res = await fetch(`${BASE}/snapshot`, { method: "POST" });
    const body = (await res.json()) as { saved: boolean };
    expect(res.status).toBe(200);
    // Persistence is disabled in test config, so it should return false
    expect(body.saved).toBe(false);
  });
});

// ── Error Handling ─────────────────────────────────────────

describe("Error handling", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${BASE}/nonexistent`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as BodyResponse;
    expect(body.error).toBe("Not found");
  });

  it("rejects invalid JSON body", async () => {
    const res = await fetch(`${BASE}/cache/test-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects keys exceeding max length", async () => {
    const longKey = "x".repeat(600);
    const res = await fetch(`${BASE}/cache/${longKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects negative TTL in mset", async () => {
    const res = await fetch(`${BASE}/cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mset",
        entries: [{ key: "k", value: "v", ttl: -1 }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown batch action", async () => {
    const res = await fetch(`${BASE}/cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invalid" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Stats History ──────────────────────────────────────────

describe("Stats history", () => {
  it("GET /stats/history returns snapshots array", async () => {
    const res = await fetch(`${BASE}/stats/history`);
    const body = (await res.json()) as { snapshots: unknown[] };
    expect(res.status).toBe(200);
    expect(Array.isArray(body.snapshots)).toBe(true);
  });
});
