// ── Database Proxy ─────────────────────────────────────────
// Connects Dunena as a caching proxy in front of external
// databases. Supports PostgreSQL, MySQL, and generic HTTP APIs.
// Queries flow through the QueryCacheService for automatic
// result caching and tag-based invalidation.

import type { QueryCacheService } from "./query-cache";
import { logger } from "../utils/logger";

const log = logger.child("db-proxy");

// ── Connector Types ────────────────────────────────────────

export type DatabaseType = "postgresql" | "mysql" | "http";

export interface DatabaseConnectorConfig {
  type: DatabaseType;
  name: string;           // unique identifier for this connection
  connectionString: string;  // DSN or URL
  readOnly?: boolean;
  maxCacheTTL?: number;   // max TTL for cached queries (ms)
  defaultTags?: string[]; // default tags applied to all cached queries
}

export interface ProxyQueryRequest {
  connector: string;      // name of the registered connector
  query: string;          // SQL query or HTTP endpoint
  params?: unknown[];     // parameterised query params  
  cacheKey?: string;      // custom cache key (auto-generated if omitted)
  ttl?: number;           // cache TTL override
  tags?: string[];        // cache invalidation tags
  skipCache?: boolean;    // force bypass cache
}

export interface ProxyQueryResult {
  data: unknown;
  cached: boolean;
  connector: string;
  durationMs: number;
  cacheKey: string;
}

// ── HTTP Database Connector ────────────────────────────────
// Forwards queries to an external HTTP-based database API
// (e.g., Supabase REST, PlanetScale HTTP, Turso, Neon serverless, etc.)

export class HttpDatabaseConnector {
  private config: DatabaseConnectorConfig;

  constructor(config: DatabaseConnectorConfig) {
    if (config.type !== "http") {
      throw new Error(`HttpDatabaseConnector requires type=http, got ${config.type}`);
    }
    this.config = config;
    log.info("HTTP database connector registered", { name: config.name, url: config.connectionString });
  }

  async execute(query: string, params?: unknown[]): Promise<unknown> {
    const url = this.config.connectionString;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, params }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP database query failed (${response.status}): ${text}`);
    }

    return response.json();
  }
}

// ── SQL Connector (PostgreSQL / MySQL via HTTP bridge) ─────
// In Bun, we can use pg or mysql2 native drivers. However, to
// keep this zero-dependency, we support SQL databases through
// a generic HTTP bridge pattern — you run a sidecar that
// exposes your DB as an HTTP endpoint.

export class SqlDatabaseConnector {
  private config: DatabaseConnectorConfig;

  constructor(config: DatabaseConnectorConfig) {
    this.config = config;
    log.info("SQL database connector registered", {
      name: config.name,
      type: config.type,
    });
  }

  /**
   * Execute a query by posting to the connection string URL.
   * The URL should point to a database HTTP bridge that accepts
   * { query, params } and returns rows.
   */
  async execute(query: string, params?: unknown[]): Promise<unknown> {
    const response = await fetch(this.config.connectionString, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: this.config.type,
        query,
        params: params ?? [],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.config.type} query failed (${response.status}): ${text}`);
    }

    return response.json();
  }
}

// ── Connector Registry ─────────────────────────────────────

type AnyConnector = HttpDatabaseConnector | SqlDatabaseConnector;

function createConnector(config: DatabaseConnectorConfig): AnyConnector {
  switch (config.type) {
    case "http":
      return new HttpDatabaseConnector(config);
    case "postgresql":
    case "mysql":
      return new SqlDatabaseConnector(config);
    default:
      throw new Error(`Unknown database type: ${config.type}`);
  }
}

// ── Database Proxy Service ─────────────────────────────────

export class DatabaseProxy {
  private connectors = new Map<string, { connector: AnyConnector; config: DatabaseConnectorConfig }>();
  private queryCache: QueryCacheService;

  constructor(queryCache: QueryCacheService) {
    this.queryCache = queryCache;
  }

  /**
   * Register a database connector.
   */
  register(config: DatabaseConnectorConfig): void {
    if (this.connectors.has(config.name)) {
      throw new Error(`Connector "${config.name}" is already registered`);
    }
    const connector = createConnector(config);
    this.connectors.set(config.name, { connector, config });
  }

  /**
   * Unregister a connector.
   */
  unregister(name: string): boolean {
    return this.connectors.delete(name);
  }

  /**
   * List all registered connectors.
   */
  list(): Array<{ name: string; type: DatabaseType; readOnly: boolean }> {
    return Array.from(this.connectors.entries()).map(([name, { config }]) => ({
      name,
      type: config.type,
      readOnly: config.readOnly ?? false,
    }));
  }

  /**
   * Execute a query through the proxy. Automatically caches
   * results unless skipCache is set.
   */
  async query(request: ProxyQueryRequest): Promise<ProxyQueryResult> {
    const entry = this.connectors.get(request.connector);
    if (!entry) {
      throw new Error(`Unknown connector: "${request.connector}"`);
    }

    const { connector, config } = entry;
    const cacheKey = request.cacheKey ?? this.generateCacheKey(request);
    const tags = [...(config.defaultTags ?? []), ...(request.tags ?? [])];

    // Check cache first (unless explicitly skipped)
    if (!request.skipCache) {
      const cached = await this.queryCache.get(cacheKey);
      if (cached) {
        return {
          data: cached.data,
          cached: true,
          connector: request.connector,
          durationMs: 0,
          cacheKey,
        };
      }
    }

    // Execute the real query
    const start = performance.now();
    const data = await connector.execute(request.query, request.params);
    const durationMs = performance.now() - start;

    // Enforce read-only
    if (config.readOnly && this.isMutation(request.query)) {
      throw new Error(`Connector "${request.connector}" is read-only`);
    }

    // Cache the result
    if (!request.skipCache) {
      const ttl = Math.min(
        request.ttl ?? config.maxCacheTTL ?? 60_000,
        config.maxCacheTTL ?? Infinity
      );
      await this.queryCache.set(cacheKey, data, { ttl, tags });
    }

    return {
      data,
      cached: false,
      connector: request.connector,
      durationMs,
      cacheKey,
    };
  }

  /**
   * Invalidate all cached queries tagged with the given tags.
   */
  async invalidate(tags: string[]): Promise<number> {
    return this.queryCache.invalidateByTags(tags);
  }

  private generateCacheKey(request: ProxyQueryRequest): string {
    const parts = [request.connector, request.query];
    if (request.params?.length) {
      parts.push(JSON.stringify(request.params));
    }
    // Simple FNV-1a-like hash for short, collision-resistant keys
    let hash = 2166136261;
    const str = parts.join("|");
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return `qc_${hash.toString(36)}`;
  }

  private isMutation(query: string): boolean {
    const upper = query.trimStart().toUpperCase();
    return upper.startsWith("INSERT") ||
           upper.startsWith("UPDATE") ||
           upper.startsWith("DELETE") ||
           upper.startsWith("DROP") ||
           upper.startsWith("ALTER") ||
           upper.startsWith("CREATE") ||
           upper.startsWith("TRUNCATE");
  }
}
