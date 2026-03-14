// ── Query Cache Service ────────────────────────────────────
// Caches database query results with automatic TTL expiration
// and tag-based invalidation. Works as a "cache-aside" layer
// that can sit in front of any external database.
//
// Usage patterns:
//   1. Direct: Store/retrieve query results by a cache key
//   2. Tag-based invalidation: Tag results by table/entity, then
//      invalidate all results touching that table on a write
//   3. Write-through: Dunena caches reads, external app invalidates
//      via POST /query-cache/invalidate

import type { StorageAdapter, StorageEntry } from "./adapter";
import type { CacheService } from "../services/cache-service";
import { logger } from "../utils/logger";

const log = logger.child("query-cache");

const QUERY_CACHE_NS = "__qcache__";

export interface QueryCacheResult {
  key: string;
  data: unknown;
  cached: boolean;       // true if served from cache
  age: number;           // ms since entry was stored
  tags: string[];
}

export interface QueryCacheStats {
  totalCached: number;
  hits: number;
  misses: number;
  invalidations: number;
  hitRate: number;
}

export class QueryCacheService {
  private adapter: StorageAdapter;
  private memCache: CacheService;
  private hits = 0;
  private misses = 0;
  private invalidations = 0;
  private defaultTTL: number;

  constructor(adapter: StorageAdapter, memCache: CacheService, defaultTTL = 60_000) {
    this.adapter = adapter;
    this.memCache = memCache;
    this.defaultTTL = defaultTTL;
    log.info("Query cache service initialised", { backend: adapter.name, defaultTTL });
  }

  /**
   * Get a cached query result. Checks in-memory cache first,
   * then falls back to the storage adapter.
   */
  async get(key: string): Promise<QueryCacheResult | null> {
    // L1: in-memory (Zig cache) — fastest
    const memVal = this.memCache.get(key, QUERY_CACHE_NS);
    if (memVal !== null) {
      this.hits++;
      try {
        const parsed = JSON.parse(memVal) as { data: unknown; tags: string[]; storedAt: number };
        return {
          key,
          data: parsed.data,
          cached: true,
          age: Date.now() - parsed.storedAt,
          tags: parsed.tags,
        };
      } catch {
        // corrupted entry, fall through
      }
    }

    // L2: persistent storage (SQLite)
    const entry = await this.adapter.get(key, QUERY_CACHE_NS);
    if (entry) {
      this.hits++;
      const data = JSON.parse(entry.value);
      // Promote back to L1
      this.memCache.set(key, entry.value, undefined, QUERY_CACHE_NS);
      return {
        key,
        data,
        cached: true,
        age: Date.now() - entry.updatedAt,
        tags: entry.tags,
      };
    }

    this.misses++;
    return null;
  }

  /**
   * Store a query result. Writes to both in-memory cache and
   * persistent storage.
   */
  async set(key: string, data: unknown, options?: {
    ttl?: number;
    tags?: string[];
  }): Promise<void> {
    const ttl = options?.ttl ?? this.defaultTTL;
    const tags = options?.tags ?? [];
    const envelope = JSON.stringify({ data, tags, storedAt: Date.now() });

    // L1: in-memory for fast reads
    this.memCache.set(key, envelope, ttl > 0 ? ttl : undefined, QUERY_CACHE_NS);

    // L2: persistent
    await this.adapter.set(key, envelope, {
      namespace: QUERY_CACHE_NS,
      ttl: ttl > 0 ? ttl : undefined,
      tags,
    });
  }

  /**
   * Invalidate cached queries by tags (e.g., table names).
   * This is the main write-invalidation path.
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    if (tags.length === 0) return 0;

    // Get keys that match these tags so we can also evict from L1
    const entries = await this.adapter.query({
      namespace: QUERY_CACHE_NS,
      tags,
    });

    // Evict from L1
    for (const entry of entries) {
      this.memCache.delete(entry.key, QUERY_CACHE_NS);
    }

    // Evict from L2
    const deleted = await this.adapter.deleteByTags(tags, QUERY_CACHE_NS);
    this.invalidations += deleted;
    log.debug("Invalidated by tags", { tags, deleted });
    return deleted;
  }

  /**
   * Invalidate a single cached query by key.
   */
  async invalidate(key: string): Promise<boolean> {
    this.memCache.delete(key, QUERY_CACHE_NS);
    const deleted = await this.adapter.delete(key, QUERY_CACHE_NS);
    if (deleted) this.invalidations++;
    return deleted;
  }

  /**
   * Clear the entire query cache.
   */
  async clear(): Promise<void> {
    await this.adapter.clear(QUERY_CACHE_NS);
    log.info("Query cache cleared");
  }

  /**
   * Get query cache statistics.
   */
  stats(): QueryCacheStats {
    const total = this.hits + this.misses;
    return {
      totalCached: 0, // filled async if needed
      hits: this.hits,
      misses: this.misses,
      invalidations: this.invalidations,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  async fullStats(): Promise<QueryCacheStats> {
    const base = this.stats();
    base.totalCached = await this.adapter.count(QUERY_CACHE_NS);
    return base;
  }
}
