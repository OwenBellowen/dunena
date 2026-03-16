// ── HTTP Application ───────────────────────────────────────
import { Router } from "./router";
import {
  corsHeaders,
  handleCors,
  authenticate,
  rateLimit,
  logRequest,
  checkBodySize,
} from "./middleware";
import { createWebSocketHandlers } from "./websocket";
import { CacheService } from "../services/cache-service";
import { AnalyticsService } from "../services/analytics-service";
import { PubSubService } from "../services/pubsub-service";
import {
  validateKey,
  validateValue,
  validateTTL,
  validationError,
} from "../utils/validation";
import { logger } from "../utils/logger";
import type { AppConfig, WebSocketData } from "../types";
import { resolve, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { PersistenceService } from "../services/persistence-service";
import { SQLiteAdapter } from "../db/sqlite-adapter";
import { QueryCacheService } from "../db/query-cache";
import { DatabaseProxy } from "../db/proxy";
import type { DatabaseConnectorConfig, ProxyQueryRequest } from "../db/proxy";

const log = logger.child("app");

export function createApp(appConfig: AppConfig) {
  // ── Bootstrap services ─────────────────────────────────
  const pubsub = new PubSubService();
  const cacheService = new CacheService(appConfig.cache, pubsub);
  const analytics = new AnalyticsService();
  const persistence = new PersistenceService(appConfig.persistence);

  // Wire persistence and restore snapshot from disk
  persistence.attach(cacheService);
  const restored = persistence.load();
  if (restored > 0) log.info(`Restored ${restored} entries from snapshot`);
  persistence.start();

  // Snapshot analytics every 60 s
  const snapshotInterval = setInterval(() => {
    analytics.takeSnapshot(cacheService.stats());
  }, 60_000);
  snapshotInterval.unref();

  // ── Database layer ─────────────────────────────────────
  let sqliteAdapter: SQLiteAdapter | null = null;
  let queryCache: QueryCacheService | null = null;
  let dbProxy: DatabaseProxy | null = null;
  let purgeInterval: Timer | null = null;

  if (appConfig.database.enabled) {
    const dbDir = dirname(resolve(appConfig.database.sqlitePath));
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

    sqliteAdapter = new SQLiteAdapter({ path: appConfig.database.sqlitePath });
    queryCache = new QueryCacheService(sqliteAdapter, cacheService, appConfig.database.queryCacheTTL);
    dbProxy = new DatabaseProxy(queryCache);

    // Periodic expired-entry purge
    if (appConfig.database.purgeIntervalMs > 0) {
      purgeInterval = setInterval(() => {
        sqliteAdapter!.purgeExpired();
      }, appConfig.database.purgeIntervalMs);
      purgeInterval.unref();
    }
  }

  // ── Routes ─────────────────────────────────────────────
  const router = new Router();

  // Health
  router.get("/health", () =>
    Response.json({ status: "ok", uptime: process.uptime() })
  );

  // ── Cache CRUD ─────────────────────────────────────────

  router.get("/cache/:key", (req, params) => {
    const kv = validateKey(params.key);
    if (!kv.valid) return validationError(kv.error!);

    const ns = new URL(req.url).searchParams.get("ns") ?? undefined;
    const value = cacheService.get(params.key, ns);
    if (value === null) {
      return Response.json({ error: "Key not found" }, { status: 404 });
    }
    return Response.json({ key: params.key, value });
  });

  router.post("/cache/:key", async (req, params) => {
    const kv = validateKey(params.key);
    if (!kv.valid) return validationError(kv.error!);

    let body: { value?: unknown; ttl?: unknown; ns?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }

    const vv = validateValue(body.value);
    if (!vv.valid) return validationError(vv.error!);
    const tv = validateTTL(body.ttl);
    if (!tv.valid) return validationError(tv.error!);

    const ok = cacheService.set(
      params.key,
      body.value as string,
      body.ttl as number | undefined,
      body.ns ?? new URL(req.url).searchParams.get("ns") ?? undefined
    );
    return Response.json({ ok }, { status: ok ? 201 : 500 });
  });

  router.delete("/cache/:key", (req, params) => {
    const kv = validateKey(params.key);
    if (!kv.valid) return validationError(kv.error!);

    const ns = new URL(req.url).searchParams.get("ns") ?? undefined;
    const deleted = cacheService.delete(params.key, ns);
    return Response.json({ deleted });
  });

  // ── Batch Operations ───────────────────────────────────

  router.post("/cache", async (req) => {
    let body: {
      action?: string;
      keys?: string[];
      entries?: Array<{ key: string; value: string; ttl?: number }>;
      ns?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }

    if (body.action === "mget" && Array.isArray(body.keys)) {
      const result = cacheService.mget(body.keys, body.ns);
      return Response.json({ result });
    }

    if (body.action === "mset" && Array.isArray(body.entries)) {
      for (const e of body.entries) {
        const ek = validateKey(e.key);
        if (!ek.valid) return validationError(`mset key error: ${ek.error}`);
        const ev = validateValue(e.value);
        if (!ev.valid) return validationError(`mset value error for "${e.key}": ${ev.error}`);
        if (e.ttl !== undefined) {
          const et = validateTTL(e.ttl);
          if (!et.valid) return validationError(`mset ttl error for "${e.key}": ${et.error}`);
        }
      }
      const count = cacheService.mset(body.entries, body.ns);
      return Response.json({ stored: count });
    }

    return validationError('Unknown action. Use "mget" or "mset".');
  });

  // ── Key Scanning ───────────────────────────────────────

  router.get("/keys", (req) => {
    const url = new URL(req.url);
    const pattern = url.searchParams.get("pattern") ?? "*";
    const ns = url.searchParams.get("ns") ?? undefined;
    const cursor = parseInt(url.searchParams.get("cursor") ?? "0", 10);
    const count = Math.min(
      parseInt(url.searchParams.get("count") ?? "100", 10),
      1000
    );
    const result = cacheService.keys(pattern, ns, cursor, count);
    return Response.json(result);
  });

  // ── Management ─────────────────────────────────────────

  router.get("/stats", () => {
    const stats = cacheService.stats();
    const latency = analytics.getLatencyStats();
    return Response.json({ cache: stats, latency });
  });

  router.get("/stats/history", () => {
    const count = 60;
    return Response.json({ snapshots: analytics.getHistory(count) });
  });

  router.post("/flush", () => {
    cacheService.clear();
    return Response.json({ flushed: true });
  });

  // On-demand snapshot save
  router.post("/snapshot", () => {
    const ok = persistence.save();
    return Response.json({ saved: ok });
  });

  router.get("/info", () =>
    Response.json({
      name: "dunena",
      version: "0.2.0",
      entries: cacheService.count(),
      uptime: process.uptime(),
      database: appConfig.database.enabled,
    })
  );

  // ── Database / Storage Endpoints ───────────────────────

  // SQLite direct key-value storage
  router.get("/db/:key", async (req, params) => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    const kv = validateKey(params.key);
    if (!kv.valid) return validationError(kv.error!);
    const ns = new URL(req.url).searchParams.get("ns") ?? "";
    const entry = await sqliteAdapter.get(params.key, ns);
    if (!entry) return Response.json({ error: "Key not found" }, { status: 404 });
    return Response.json(entry);
  });

  router.post("/db/:key", async (req, params) => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    const kv = validateKey(params.key);
    if (!kv.valid) return validationError(kv.error!);
    let body: { value?: unknown; ttl?: unknown; ns?: string; tags?: string[] };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }
    const vv = validateValue(body.value);
    if (!vv.valid) return validationError(vv.error!);
    const tv = validateTTL(body.ttl);
    if (!tv.valid) return validationError(tv.error!);
    const ns = body.ns ?? new URL(req.url).searchParams.get("ns") ?? "";
    const ok = await sqliteAdapter.set(params.key, body.value as string, {
      namespace: ns,
      ttl: body.ttl as number | undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined,
    });
    return Response.json({ ok }, { status: ok ? 201 : 500 });
  });

  router.delete("/db/:key", async (req, params) => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    const kv = validateKey(params.key);
    if (!kv.valid) return validationError(kv.error!);
    const ns = new URL(req.url).searchParams.get("ns") ?? "";
    const deleted = await sqliteAdapter.delete(params.key, ns);
    return Response.json({ deleted });
  });

  // SQLite batch operations
  router.post("/db", async (req) => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    let body: {
      action?: string;
      keys?: string[];
      entries?: Array<{ key: string; value: string; ttl?: number; tags?: string[] }>;
      ns?: string;
      tags?: string[];
      pattern?: string;
      limit?: number;
      offset?: number;
      orderBy?: string;
      order?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }

    switch (body.action) {
      case "mget": {
        if (!Array.isArray(body.keys)) return validationError("keys must be an array");
        const result = await sqliteAdapter.mget(body.keys, body.ns ?? "");
        return Response.json({ result });
      }
      case "mset": {
        if (!Array.isArray(body.entries)) return validationError("entries must be an array");
        for (const e of body.entries) {
          const ek = validateKey(e.key);
          if (!ek.valid) return validationError(`mset key error: ${ek.error}`);
          const ev = validateValue(e.value);
          if (!ev.valid) return validationError(`mset value error for "${e.key}": ${ev.error}`);
        }
        const count = await sqliteAdapter.mset(body.entries, body.ns ?? "");
        return Response.json({ stored: count });
      }
      case "mdelete": {
        if (!Array.isArray(body.keys)) return validationError("keys must be an array");
        const deleted = await sqliteAdapter.mdelete(body.keys, body.ns ?? "");
        return Response.json({ deleted });
      }
      case "query": {
        const entries = await sqliteAdapter.query({
          namespace: body.ns,
          prefix: body.pattern,
          tags: body.tags,
          limit: body.limit,
          offset: body.offset,
          orderBy: body.orderBy as "key" | "createdAt" | "updatedAt" | undefined,
          order: body.order as "asc" | "desc" | undefined,
        });
        return Response.json({ entries, count: entries.length });
      }
      case "deleteByTags": {
        if (!Array.isArray(body.tags)) return validationError("tags must be an array");
        const deleted = await sqliteAdapter.deleteByTags(body.tags, body.ns);
        return Response.json({ deleted });
      }
      default:
        return validationError('Unknown action. Use "mget", "mset", "mdelete", "query", or "deleteByTags".');
    }
  });

  // Database stats
  router.get("/db-stats", async () => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    const stats = await sqliteAdapter.stats();
    return Response.json(stats);
  });

  // Database keys listing
  router.get("/db-keys", async (req) => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    const url = new URL(req.url);
    const pattern = url.searchParams.get("pattern") ?? "*";
    const ns = url.searchParams.get("ns") ?? undefined;
    const keys = await sqliteAdapter.keys(pattern, ns);
    return Response.json({ keys, count: keys.length });
  });

  // Database clear
  router.post("/db-clear", async (req) => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    const url = new URL(req.url);
    const ns = url.searchParams.get("ns") ?? undefined;
    await sqliteAdapter.clear(ns);
    return Response.json({ cleared: true });
  });

  // Purge expired entries
  router.post("/db-purge", async () => {
    if (!sqliteAdapter) return Response.json({ error: "Database disabled" }, { status: 503 });
    const purged = await sqliteAdapter.purgeExpired();
    return Response.json({ purged });
  });

  // ── Query Cache Endpoints ──────────────────────────────

  // Specific routes must come before parameterized /:key
  router.get("/query-cache/stats", async () => {
    if (!queryCache) return Response.json({ error: "Database disabled" }, { status: 503 });
    const stats = await queryCache.fullStats();
    return Response.json(stats);
  });

  router.get("/query-cache/:key", async (_req, params) => {
    if (!queryCache) return Response.json({ error: "Database disabled" }, { status: 503 });
    const result = await queryCache.get(params.key);
    if (!result) return Response.json({ error: "Cache miss" }, { status: 404 });
    return Response.json(result);
  });

  router.post("/query-cache", async (req) => {
    if (!queryCache) return Response.json({ error: "Database disabled" }, { status: 503 });
    let body: { key?: string; data?: unknown; ttl?: number; tags?: string[] };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }
    if (!body.key || typeof body.key !== "string") return validationError("key is required");
    if (body.data === undefined) return validationError("data is required");
    await queryCache.set(body.key, body.data, { ttl: body.ttl, tags: body.tags });
    return Response.json({ cached: true, key: body.key }, { status: 201 });
  });

  router.post("/query-cache/invalidate", async (req) => {
    if (!queryCache) return Response.json({ error: "Database disabled" }, { status: 503 });
    let body: { tags?: string[]; key?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }
    if (body.key) {
      const ok = await queryCache.invalidate(body.key);
      return Response.json({ invalidated: ok ? 1 : 0 });
    }
    if (Array.isArray(body.tags) && body.tags.length > 0) {
      const count = await queryCache.invalidateByTags(body.tags);
      return Response.json({ invalidated: count });
    }
    return validationError("Provide either tags (array) or key (string)");
  });

  router.post("/query-cache/clear", async () => {
    if (!queryCache) return Response.json({ error: "Database disabled" }, { status: 503 });
    await queryCache.clear();
    return Response.json({ cleared: true });
  });

  // ── Database Proxy Endpoints ───────────────────────────

  router.get("/db-proxy/connectors", () => {
    if (!dbProxy) return Response.json({ error: "Database disabled" }, { status: 503 });
    return Response.json({ connectors: dbProxy.list() });
  });

  router.post("/db-proxy/register", async (req) => {
    if (!dbProxy) return Response.json({ error: "Database disabled" }, { status: 503 });
    let body: DatabaseConnectorConfig;
    try {
      body = (await req.json()) as DatabaseConnectorConfig;
    } catch {
      return validationError("Invalid JSON body");
    }
    if (!body.name || !body.type || !body.connectionString) {
      return validationError("name, type, and connectionString are required");
    }
    if (!["postgresql", "mysql", "http"].includes(body.type)) {
      return validationError("type must be postgresql, mysql, or http");
    }
    try {
      dbProxy.register(body);
      return Response.json({ registered: true, name: body.name }, { status: 201 });
    } catch (err) {
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 409 });
    }
  });

  router.post("/db-proxy/unregister", async (req) => {
    if (!dbProxy) return Response.json({ error: "Database disabled" }, { status: 503 });
    let body: { name?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }
    if (!body.name) return validationError("name is required");
    const ok = dbProxy.unregister(body.name);
    return Response.json({ unregistered: ok });
  });

  router.post("/db-proxy/query", async (req) => {
    if (!dbProxy) return Response.json({ error: "Database disabled" }, { status: 503 });
    let body: ProxyQueryRequest;
    try {
      body = (await req.json()) as ProxyQueryRequest;
    } catch {
      return validationError("Invalid JSON body");
    }
    if (!body.connector || !body.query) {
      return validationError("connector and query are required");
    }
    try {
      const result = await dbProxy.query(body);
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { error: String(err instanceof Error ? err.message : err) },
        { status: 502 }
      );
    }
  });

  router.post("/db-proxy/invalidate", async (req) => {
    if (!dbProxy) return Response.json({ error: "Database disabled" }, { status: 503 });
    let body: { tags?: string[] };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return validationError("Invalid JSON body");
    }
    if (!Array.isArray(body.tags) || body.tags.length === 0) {
      return validationError("tags (non-empty array) is required");
    }
    const count = await dbProxy.invalidate(body.tags);
    return Response.json({ invalidated: count });
  });

  // ── Prometheus Metrics ─────────────────────────────────

  router.get("/metrics", () => {
    const s = cacheService.stats();
    const latency = analytics.getLatencyStats();
    const lines = [
      "# HELP dunena_cache_hits_total Total cache hits",
      "# TYPE dunena_cache_hits_total counter",
      `dunena_cache_hits_total ${s.hits}`,
      "# HELP dunena_cache_misses_total Total cache misses",
      "# TYPE dunena_cache_misses_total counter",
      `dunena_cache_misses_total ${s.misses}`,
      "# HELP dunena_cache_evictions_total Total cache evictions",
      "# TYPE dunena_cache_evictions_total counter",
      `dunena_cache_evictions_total ${s.evictions}`,
      "# HELP dunena_cache_puts_total Total cache puts",
      "# TYPE dunena_cache_puts_total counter",
      `dunena_cache_puts_total ${s.puts}`,
      "# HELP dunena_cache_deletes_total Total cache deletes",
      "# TYPE dunena_cache_deletes_total counter",
      `dunena_cache_deletes_total ${s.deletes}`,
      "# HELP dunena_cache_entries Current number of entries",
      "# TYPE dunena_cache_entries gauge",
      `dunena_cache_entries ${s.currentSize}`,
      "# HELP dunena_cache_max_entries Maximum cache capacity",
      "# TYPE dunena_cache_max_entries gauge",
      `dunena_cache_max_entries ${s.maxSize}`,
      "# HELP dunena_cache_hit_rate Cache hit rate (0-1)",
      "# TYPE dunena_cache_hit_rate gauge",
      `dunena_cache_hit_rate ${s.hitRate}`,
      "# HELP dunena_request_latency_ms Request latency in milliseconds",
      "# TYPE dunena_request_latency_ms summary",
      `dunena_request_latency_ms{quantile="0.5"} ${latency.p50.toFixed(3)}`,
      `dunena_request_latency_ms{quantile="0.95"} ${latency.p95.toFixed(3)}`,
      `dunena_request_latency_ms{quantile="0.99"} ${latency.p99.toFixed(3)}`,
      `dunena_request_latency_ms_sum ${(latency.mean * (latency.count || 1)).toFixed(3)}`,
      `dunena_request_latency_ms_count ${latency.count || 0}`,
      "# HELP dunena_uptime_seconds Server uptime in seconds",
      "# TYPE dunena_uptime_seconds gauge",
      `dunena_uptime_seconds ${process.uptime().toFixed(1)}`,
    ];
    return new Response(lines.join("\n") + "\n", {
      headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  });

  // ── WebSocket handlers ─────────────────────────────────
  const wsHandlers = createWebSocketHandlers(cacheService);

  // Forward cache events → Bun WS topics so connected clients receive them
  pubsub.subscribe("cache", (msg) => {
    try {
      server.publish("cache-events", JSON.stringify(msg));
    } catch {
      /* server may not have started yet */
    }
  });

  // ── Bun.serve ──────────────────────────────────────────
  const dashboardPath = resolve(import.meta.dir, "../../public/dashboard.html");
  const docsDir = resolve(import.meta.dir, "../../docs");

  const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  const server = Bun.serve<WebSocketData>({
    port: appConfig.server.port,
    hostname: appConfig.server.host,

    fetch(req, server) {
      const start = performance.now();
      const url = new URL(req.url);
      const reqOrigin = req.headers.get("origin") ?? undefined;

      // CORS preflight
      const corsResp = handleCors(req, appConfig.server);
      if (corsResp) return corsResp;

      // WebSocket upgrade
      if (
        appConfig.server.enableWebSocket &&
        url.pathname === "/ws"
      ) {
        // Auth check for WebSocket
        const wsAuth = authenticate(req, appConfig.server.authToken);
        if (wsAuth) return wsAuth;

        const upgraded = server.upgrade(req, {
          data: {
            subscribedChannels: new Set<string>(),
            connectedAt: Date.now(),
            id: "",
          } satisfies WebSocketData,
        });
        if (upgraded) return undefined as unknown as Response;
      }

      // Dashboard
      if (
        appConfig.server.enableDashboard &&
        url.pathname === "/dashboard"
      ) {
        return new Response(Bun.file(dashboardPath), {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Documentation site
      if (url.pathname === "/" || url.pathname.startsWith("/docs")) {
        // Redirection: /docs -> /docs/ (so relative assets resolve correctly)
        if (url.pathname === "/docs") {
          return Response.redirect(url.origin + "/docs/", 301);
        }

        let filePath: string;
        if (url.pathname === "/" || url.pathname === "/docs" || url.pathname === "/docs/") {
          filePath = resolve(docsDir, "index.html");
        } else {
          // Map /docs/getting-started → docs/getting-started.html
          // Map /docs/assets/style.css → docs/assets/style.css
          let rel = url.pathname.slice(6); // strip "/docs/"
          if (rel.startsWith("/")) rel = rel.slice(1);
          
          filePath = resolve(docsDir, rel || "index.html");
          
          // If no extension, try .html
          if (!rel.includes(".") && rel !== "") {
            filePath = resolve(docsDir, rel + ".html");
          }
        }
        // Guard against path traversal — resolved path must stay within docsDir
        const normalised = resolve(filePath);
        if (!normalised.startsWith(docsDir)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        if (existsSync(normalised)) {
          const ext = "." + normalised.split(".").pop();
          const mime = MIME_TYPES[ext] ?? "application/octet-stream";
          return new Response(Bun.file(normalised), { headers: { "Content-Type": mime } });
        }
      }

      // Auth
      const authResp = authenticate(req, appConfig.server.authToken);
      if (authResp && !url.pathname.startsWith("/health")) return authResp;

      // Body size check
      const bodyResp = checkBodySize(req);
      if (bodyResp) return bodyResp;

      // Rate limiting
      const rlResp = rateLimit(req, appConfig.server);
      if (rlResp) return rlResp;

      // Router
      const match = router.match(req.method, url.pathname);
      if (!match) {
        const resp = Response.json(
          { error: "Not found" },
          {
            status: 404,
            headers: corsHeaders(appConfig.server, reqOrigin),
          }
        );
        logRequest(req, url, 404, performance.now() - start);
        return resp;
      }

      analytics.recordRequest();

      try {
        const result = match.handler(req, match.params);
        const respond = (resp: Response) => {
          const duration = performance.now() - start;
          analytics.recordLatency(duration);
          // Build new response with CORS headers (Response.json headers may be immutable)
          const hdrs = new Headers(resp.headers);
          for (const [k, v] of Object.entries(corsHeaders(appConfig.server, reqOrigin))) {
            hdrs.set(k, v);
          }
          logRequest(req, url, resp.status, duration);
          return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: hdrs,
          });
        };

        if (result instanceof Promise) {
          return result.then(respond).catch((err) => {
            const duration = performance.now() - start;
            log.error("Handler error", { error: String(err) });
            logRequest(req, url, 500, duration);
            return Response.json(
              { error: "Internal server error" },
              { status: 500, headers: corsHeaders(appConfig.server, reqOrigin) }
            );
          });
        }
        return respond(result);
      } catch (err) {
        const duration = performance.now() - start;
        log.error("Handler error", { error: String(err) });
        logRequest(req, url, 500, duration);
        return Response.json(
          { error: "Internal server error" },
          { status: 500, headers: corsHeaders(appConfig.server, reqOrigin) }
        );
      }
    },

    websocket: wsHandlers,
  });

  log.info(`Dunena listening on http://${server.hostname}:${server.port}`);
  if (appConfig.server.enableWebSocket)
    log.info(`WebSocket available at ws://${server.hostname}:${server.port}/ws`);
  if (appConfig.server.enableDashboard)
    log.info(
      `Dashboard at http://${server.hostname}:${server.port}/dashboard`
    );
  log.info(`Documentation at http://${server.hostname}:${server.port}/docs`);
  if (appConfig.database.enabled)
    log.info(`Database layer enabled (SQLite at ${appConfig.database.sqlitePath})`);

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down\u2026");
    clearInterval(snapshotInterval);
    if (purgeInterval) clearInterval(purgeInterval);
    persistence.stop();
    if (appConfig.persistence.saveOnShutdown) {
      persistence.save();
    }
    if (sqliteAdapter) await sqliteAdapter.close();
    cacheService.destroy();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, cacheService, analytics, pubsub, persistence, sqliteAdapter, queryCache, dbProxy };
}
