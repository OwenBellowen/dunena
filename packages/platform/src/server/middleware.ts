// ── Middleware ──────────────────────────────────────────────
import { timingSafeEqual } from "crypto";
import type { ServerConfig, NamespaceRateLimitConfig } from "../types";
import { logger } from "../utils/logger";

const log = logger.child("http");

// ── CORS ───────────────────────────────────────────────────

export function corsHeaders(config: ServerConfig, requestOrigin?: string): Record<string, string> {
  // For a single wildcard or single origin, we can cache
  const origins = config.cors.origins;

  let allowOrigin: string;
  if (origins.length === 1 && origins[0] === "*") {
    allowOrigin = "*";
  } else if (origins.length === 1) {
    allowOrigin = origins[0];
  } else if (requestOrigin && origins.includes(requestOrigin)) {
    // Per spec: reflect the matching origin back, with Vary: Origin
    allowOrigin = requestOrigin;
  } else {
    // No matching origin — return the first configured origin
    allowOrigin = origins[0];
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": config.cors.methods.join(", "),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  // When reflecting a specific origin, add Vary header for caching correctness
  if (allowOrigin !== "*") {
    headers["Vary"] = "Origin";
  }
  return headers;
}

export function handleCors(
  req: Request,
  config: ServerConfig
): Response | null {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin") ?? undefined;
    return new Response(null, { status: 204, headers: corsHeaders(config, origin) });
  }
  return null;
}

// ── Authentication ─────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) {
    // Compare against self to keep constant time, but return false
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function authenticate(
  req: Request,
  token: string | undefined
): Response | null {
  if (!token) return null; // auth disabled
  const auth = req.headers.get("authorization");
  if (!auth || !constantTimeEqual(auth, `Bearer ${token}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// ── Rate Limiting ──────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, RateBucket>();

// Periodically purge stale buckets to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (now - bucket.windowStart > 120_000) buckets.delete(ip);
  }
}, 60_000).unref();

export function rateLimit(
  req: Request,
  config: ServerConfig
): Response | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  let bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart > config.rateLimit.windowMs) {
    bucket = { count: 0, windowStart: now };
    buckets.set(ip, bucket);
  }

  bucket.count++;
  if (bucket.count > config.rateLimit.maxRequests) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  return null;
}

// ── Namespace Rate Limiting ────────────────────────────────

interface NamespaceRateBucket {
  count: number;
  windowStart: number;
}

// Map: namespace -> IP -> bucket
const namespaceBuckets = new Map<string, Map<string, NamespaceRateBucket>>();
const namespaceConfigs = new Map<string, NamespaceRateLimitConfig>();

// Periodically purge stale namespace buckets
setInterval(() => {
  const now = Date.now();
  for (const [ns, ipMap] of namespaceBuckets) {
    for (const [ip, bucket] of ipMap) {
      if (now - bucket.windowStart > 120_000) ipMap.delete(ip);
    }
    if (ipMap.size === 0) namespaceBuckets.delete(ns);
  }
}, 60_000).unref();

/**
 * Configure rate limit for a specific namespace
 */
export function configureNamespaceRateLimit(config: NamespaceRateLimitConfig): void {
  namespaceConfigs.set(config.namespace, config);
  log.info("Namespace rate limit configured", { namespace: config.namespace, maxRequests: config.maxRequests, windowMs: config.windowMs });
}

/**
 * Remove rate limit configuration for a namespace
 */
export function removeNamespaceRateLimit(namespace: string): boolean {
  const existed = namespaceConfigs.delete(namespace);
  if (existed) {
    namespaceBuckets.delete(namespace);
    log.info("Namespace rate limit removed", { namespace });
  }
  return existed;
}

/**
 * Get all configured namespace rate limits
 */
export function getNamespaceRateLimits(): NamespaceRateLimitConfig[] {
  return Array.from(namespaceConfigs.values());
}

/**
 * Check namespace-specific rate limit
 * Returns 429 response if limit exceeded, null otherwise
 */
export function namespaceRateLimit(
  req: Request,
  namespace: string | undefined
): Response | null {
  if (!namespace) return null;
  
  const config = namespaceConfigs.get(namespace);
  if (!config) return null; // No specific limit for this namespace

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();

  let ipMap = namespaceBuckets.get(namespace);
  if (!ipMap) {
    ipMap = new Map();
    namespaceBuckets.set(namespace, ipMap);
  }

  let bucket = ipMap.get(ip);
  if (!bucket || now - bucket.windowStart > config.windowMs) {
    bucket = { count: 0, windowStart: now };
    ipMap.set(ip, bucket);
  }

  bucket.count++;
  if (bucket.count > config.maxRequests) {
    log.warn("Namespace rate limit exceeded", { namespace, ip });
    return Response.json(
      { error: "Namespace rate limit exceeded", namespace },
      { status: 429 }
    );
  }
  return null;
}

/**
 * Get rate limit stats for a namespace
 */
export function getNamespaceRateLimitStats(namespace: string): { activeClients: number; config: NamespaceRateLimitConfig | null } {
  const config = namespaceConfigs.get(namespace) ?? null;
  const ipMap = namespaceBuckets.get(namespace);
  return {
    activeClients: ipMap?.size ?? 0,
    config,
  };
}

// ── Request Logging ────────────────────────────────────────

export function logRequest(
  req: Request,
  url: URL,
  status: number,
  durationMs: number
) {
  log.info(`${req.method} ${url.pathname} ${status}`, {
    ms: Math.round(durationMs * 100) / 100,
  });
}

// ── Body Size Limit ────────────────────────────────────────

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB

export function checkBodySize(req: Request): Response | null {
  const cl = req.headers.get("content-length");
  if (cl && parseInt(cl, 10) > MAX_BODY_SIZE) {
    return Response.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }
  return null;
}
