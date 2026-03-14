// ── Cache Types ────────────────────────────────────────────

export interface CacheConfig {
  maxEntries: number;
  defaultTTL?: number;
  enableBloomFilter?: boolean;
  bloomFilterSize?: number;
  bloomFilterHashes?: number;
  compressionThreshold?: number;
}

export interface PersistenceConfig {
  enabled: boolean;
  filePath: string;
  intervalMs: number;
  saveOnShutdown: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  puts: number;
  deletes: number;
  currentSize: number;
  maxSize: number;
  hitRate: number;
}

// ── Server Types ───────────────────────────────────────────

export interface ServerConfig {
  port: number;
  host: string;
  enableWebSocket: boolean;
  enableDashboard: boolean;
  authToken?: string;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  cors: {
    origins: string[];
    methods: string[];
  };
}

export interface AppConfig {
  cache: CacheConfig;
  server: ServerConfig;
  persistence: PersistenceConfig;
  database: DatabaseConfig;
  log: {
    level: "debug" | "info" | "warn" | "error";
    format: "text" | "json";
  };
}

export interface DatabaseConfig {
  enabled: boolean;
  sqlitePath: string;
  queryCacheTTL: number;  // default TTL for query cache entries (ms)
  purgeIntervalMs: number; // how often to purge expired DB entries
}

// ── Pub/Sub Types ──────────────────────────────────────────

export interface PubSubMessage {
  channel: string;
  event: string;
  data: unknown;
  timestamp: number;
}

// ── Analytics Types ────────────────────────────────────────

export interface AnalyticsSnapshot {
  timestamp: number;
  stats: CacheStats;
  requestsPerSecond: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

// ── HTTP Types ─────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type HandlerFn = (
  req: Request,
  params: Record<string, string>
) => Promise<Response> | Response;

export interface RouteHandler {
  method: HttpMethod;
  path: string;
  handler: HandlerFn;
}

// ── WebSocket Types ────────────────────────────────────────

export interface WebSocketData {
  subscribedChannels: Set<string>;
  connectedAt: number;
  id: string;
}

export interface WSIncomingMessage {
  type: "subscribe" | "unsubscribe" | "ping" | "get" | "set" | "del" | "mget" | "mset";
  channel?: string;
  key?: string;
  value?: string;
  ns?: string;
  ttl?: number;
  keys?: string[];
  entries?: Array<{ key: string; value: string; ttl?: number }>;
}

export interface WSOutgoingMessage {
  type: string;
  data?: unknown;
  timestamp: number;
}
