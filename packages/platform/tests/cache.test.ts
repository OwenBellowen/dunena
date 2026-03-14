// ── Unit Tests for Bridge Layer ─────────────────────────────
// Tests the Zig-backed NativeCache, NativeBloomFilter,
// compression, and NativeStats directly (no HTTP).

import { describe, it, expect } from "bun:test";
import {
  NativeCache,
  NativeBloomFilter,
  NativeStats,
  compress,
  decompress,
} from "../src/bridge/cache-bridge";

// ── NativeCache ────────────────────────────────────────────

describe("NativeCache", () => {
  it("put and get", () => {
    const cache = new NativeCache(100);
    expect(cache.put("foo", "bar")).toBe(true);
    expect(cache.get("foo")).toBe("bar");
    cache.destroy();
  });

  it("returns null for missing key", () => {
    const cache = new NativeCache(100);
    expect(cache.get("nope")).toBeNull();
    cache.destroy();
  });

  it("delete", () => {
    const cache = new NativeCache(100);
    cache.put("x", "1");
    expect(cache.delete("x")).toBe(true);
    expect(cache.get("x")).toBeNull();
    expect(cache.delete("x")).toBe(false);
    cache.destroy();
  });

  it("has", () => {
    const cache = new NativeCache(100);
    cache.put("k", "v");
    expect(cache.has("k")).toBe(true);
    expect(cache.has("nope")).toBe(false);
    cache.destroy();
  });

  it("count and clear", () => {
    const cache = new NativeCache(100);
    cache.put("a", "1");
    cache.put("b", "2");
    cache.put("c", "3");
    expect(cache.count()).toBe(3);
    cache.clear();
    expect(cache.count()).toBe(0);
    cache.destroy();
  });

  it("LRU eviction", () => {
    const cache = new NativeCache(3);
    cache.put("a", "1");
    cache.put("b", "2");
    cache.put("c", "3");
    // Access "a" to make it MRU
    cache.get("a");
    // Insert "d" → evicts "b" (the LRU)
    cache.put("d", "4");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toBe("1");
    expect(cache.get("d")).toBe("4");
    cache.destroy();
  });

  it("getStats returns meaningful data", () => {
    const cache = new NativeCache(100);
    cache.put("k", "v");
    cache.get("k");
    cache.get("miss");
    const s = cache.getStats();
    expect(s.puts).toBe(1);
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.currentSize).toBe(1);
    expect(s.hitRate).toBeCloseTo(0.5);
    cache.destroy();
  });

  it("handles unicode keys and values", () => {
    const cache = new NativeCache(100);
    cache.put("emoji", "Hello 🌍🚀");
    expect(cache.get("emoji")).toBe("Hello 🌍🚀");
    cache.destroy();
  });
});

// ── NativeBloomFilter ──────────────────────────────────────

describe("NativeBloomFilter", () => {
  it("add and check", () => {
    const bf = new NativeBloomFilter(4096, 5);
    bf.add("hello");
    bf.add("world");
    expect(bf.check("hello")).toBe(true);
    expect(bf.check("world")).toBe(true);
    expect(bf.count()).toBe(2);
    bf.destroy();
  });

  it("clear resets everything", () => {
    const bf = new NativeBloomFilter(4096, 5);
    bf.add("test");
    bf.clear();
    expect(bf.count()).toBe(0);
    // After clear the item should probably not be found
    // (though bloom filters can have false positives, a cleared filter should not)
    expect(bf.check("test")).toBe(false);
    bf.destroy();
  });
});

// ── Compression ────────────────────────────────────────────

describe("Compression", () => {
  it("roundtrip text", () => {
    const original = "AAAAAABBBBCCCCCCDDDDDD";
    const compressed = compress(original);
    const decompressed = decompress(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(original);
  });

  it("roundtrip binary", () => {
    const data = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 1, 2, 3]);
    const compressed = compress(data);
    const decompressed = decompress(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(data));
  });

  it("handles empty input", () => {
    const compressed = compress("");
    expect(compressed.length).toBe(0);
  });
});

// ── NativeStats ────────────────────────────────────────────

describe("NativeStats", () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("mean", () => {
    expect(NativeStats.mean(data)).toBeCloseTo(5.5);
  });

  it("min and max", () => {
    expect(NativeStats.min(data)).toBe(1);
    expect(NativeStats.max(data)).toBe(10);
  });

  it("median", () => {
    expect(NativeStats.median(data)).toBeCloseTo(5.5);
  });

  it("stdDev", () => {
    expect(NativeStats.stdDev(data)).toBeGreaterThan(0);
  });

  it("percentile", () => {
    const p90 = NativeStats.percentile(data, 90);
    expect(p90).toBeGreaterThanOrEqual(9);
    expect(p90).toBeLessThanOrEqual(10);
  });

  it("histogram", () => {
    const counts = NativeStats.histogram(data, 5);
    expect(counts.length).toBe(5);
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(data.length);
  });
});
