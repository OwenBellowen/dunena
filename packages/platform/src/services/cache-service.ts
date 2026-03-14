// ── Cache Service ──────────────────────────────────────────
// Business-logic layer on top of NativeCache.  Adds namespace
// support, optional TTL expiry, bloom-filter pre-checks, and
// publishes mutation events through PubSubService.

import { NativeCache, NativeBloomFilter, compress, decompress } from "../bridge/cache-bridge";
import { PubSubService } from "./pubsub-service";
import type { CacheConfig, CacheStats } from "../types";
import { logger } from "../utils/logger";

const log = logger.child("cache");

export class CacheService {
  private cache: NativeCache;
  private bloom: NativeBloomFilter | null = null;
  private pubsub: PubSubService;
  private ttlTimers = new Map<string, Timer>();
  private defaultTTL: number;
  private keySet = new Set<string>();
  private compressionThreshold: number;

  constructor(config: CacheConfig, pubsub: PubSubService) {
    this.cache = new NativeCache(config.maxEntries);
    this.pubsub = pubsub;
    this.defaultTTL = config.defaultTTL ?? 0;
    this.compressionThreshold = config.compressionThreshold ?? 0;

    if (config.enableBloomFilter) {
      this.bloom = new NativeBloomFilter(
        config.bloomFilterSize ?? 1_000_000,
        config.bloomFilterHashes ?? 7
      );
      log.info("Bloom filter enabled", {
        bits: config.bloomFilterSize ?? 1_000_000,
        hashes: config.bloomFilterHashes ?? 7,
      });
    }

    log.info("Cache initialised", { maxEntries: config.maxEntries });
  }

  // ── Core operations ──────────────────────────────────────

  get(key: string, namespace?: string): string | null {
    const fk = this.fullKey(key, namespace);

    // Bloom filter short-circuit: if it says "no", it's definitely not here
    if (this.bloom && !this.bloom.check(fk)) {
      return null;
    }

    const raw = this.cache.get(fk);
    if (raw === null) return null;

    // Decompress if the value was stored compressed (prefixed with \x00CMP\x00)
    if (raw.startsWith("\x00CMP\x00")) {
      const encoded = Uint8Array.from(atob(raw.slice(5)), (c) => c.charCodeAt(0));
      const decompressed = decompress(encoded);
      return new TextDecoder().decode(decompressed);
    }
    return raw;
  }

  set(key: string, value: string, ttl?: number, namespace?: string): boolean {
    const fk = this.fullKey(key, namespace);

    // Transparent compression for large values
    let storedValue = value;
    if (this.compressionThreshold > 0 && value.length >= this.compressionThreshold) {
      const compressed = compress(value);
      storedValue = "\x00CMP\x00" + btoa(String.fromCharCode(...compressed));
    }

    const ok = this.cache.put(fk, storedValue);
    if (!ok) return false;

    this.keySet.add(fk);
    this.bloom?.add(fk);

    // TTL handling
    const effectiveTTL = ttl ?? this.defaultTTL;
    if (effectiveTTL > 0) {
      this.clearTTL(fk);
      const timer = setTimeout(() => {
        this.cache.delete(fk);
        this.keySet.delete(fk);
        this.ttlTimers.delete(fk);
        this.pubsub.publish("cache", "expired", { key: fk });
      }, effectiveTTL);
      this.ttlTimers.set(fk, timer);
    }

    this.pubsub.publish("cache", "set", { key: fk, size: value.length });
    return true;
  }

  delete(key: string, namespace?: string): boolean {
    const fk = this.fullKey(key, namespace);
    this.clearTTL(fk);
    const ok = this.cache.delete(fk);
    if (ok) {
      this.keySet.delete(fk);
      this.pubsub.publish("cache", "delete", { key: fk });
    }
    return ok;
  }

  has(key: string, namespace?: string): boolean {
    const fk = this.fullKey(key, namespace);
    if (this.bloom && !this.bloom.check(fk)) return false;
    return this.cache.has(fk);
  }

  // ── Batch operations ─────────────────────────────────────

  mget(keys: string[], namespace?: string): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const k of keys) {
      result[k] = this.get(k, namespace);
    }
    return result;
  }

  mset(
    entries: Array<{ key: string; value: string; ttl?: number }>,
    namespace?: string
  ): number {
    let count = 0;
    for (const e of entries) {
      if (this.set(e.key, e.value, e.ttl, namespace)) count++;
    }
    return count;
  }

  // ── Management ───────────────────────────────────────────

  count(): number {
    return this.cache.count();
  }

  clear(): void {
    for (const timer of this.ttlTimers.values()) clearTimeout(timer);
    this.ttlTimers.clear();
    this.keySet.clear();
    this.cache.clear();
    this.bloom?.clear();
    this.pubsub.publish("cache", "clear", {});
    log.info("Cache cleared");
  }

  stats(): CacheStats {
    return this.cache.getStats();
  }

  keys(pattern?: string, namespace?: string, cursor = 0, count = 100): { cursor: number; keys: string[] } {
    const prefix = namespace ? `${namespace}\0` : "";
    const allKeys: string[] = [];

    for (const fk of this.keySet) {
      // Filter by namespace prefix
      if (prefix && !fk.startsWith(prefix)) continue;
      // Strip namespace prefix for output
      const display = prefix ? fk.slice(prefix.length) : fk;
      // Filter by glob-like pattern (only * wildcard supported)
      if (pattern && pattern !== "*") {
        const regex = new RegExp(
          "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        );
        if (!regex.test(display)) continue;
      }
      allKeys.push(display);
    }

    allKeys.sort();
    const slice = allKeys.slice(cursor, cursor + count);
    const nextCursor = cursor + count >= allKeys.length ? 0 : cursor + count;
    return { cursor: nextCursor, keys: slice };
  }

  destroy(): void {
    for (const timer of this.ttlTimers.values()) clearTimeout(timer);
    this.ttlTimers.clear();
    this.bloom?.destroy();
    this.cache.destroy();
    log.info("Cache destroyed");
  }

  /** Export all entries for persistence (no TTL info — TTLs are transient) */
  exportEntries(): Array<{ key: string; value: string }> {
    const entries: Array<{ key: string; value: string }> = [];
    for (const fk of this.keySet) {
      const raw = this.cache.get(fk);
      if (raw !== null) {
        entries.push({ key: fk, value: raw });
      }
    }
    return entries;
  }

  /** Import a raw entry directly (used by persistence restore) */
  setRaw(fullKey: string, rawValue: string): boolean {
    const ok = this.cache.put(fullKey, rawValue);
    if (ok) {
      this.keySet.add(fullKey);
      this.bloom?.add(fullKey);
    }
    return ok;
  }

  // ── Helpers ──────────────────────────────────────────────

  private fullKey(key: string, namespace?: string): string {
    // Use \0 as separator — it's not valid in keys (printable ASCII only)
    // so there's no ambiguity: fullKey("a:b") !== fullKey("b", "a")
    return namespace ? `${namespace}\0${key}` : key;
  }

  private clearTTL(fk: string): void {
    const existing = this.ttlTimers.get(fk);
    if (existing) {
      clearTimeout(existing);
      this.ttlTimers.delete(fk);
    }
  }
}
