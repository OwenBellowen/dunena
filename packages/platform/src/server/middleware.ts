// ── Middleware ──────────────────────────────────────────────
import { timingSafeEqual } from "crypto";
import type { ServerConfig } from "../types";
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
