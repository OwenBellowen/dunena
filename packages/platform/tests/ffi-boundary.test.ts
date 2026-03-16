// ── FFI Boundary Tests ─────────────────────────────────────
// Exercises edge cases at the Zig ↔ TypeScript boundary that
// are not covered by the standard functional tests in cache.test.ts.

import { describe, it, expect } from "bun:test";
import {
  NativeCache,
  NativeBloomFilter,
  NativeStats,
  compress,
  decompress,
} from "../src/bridge/cache-bridge";

// ── NativeCache boundary cases ─────────────────────────────

describe("NativeCache — boundary cases", () => {
  it("handles empty string key", () => {
    const cache = new NativeCache(100);
    expect(cache.put("", "empty-key-value")).toBe(true);
    expect(cache.get("")).toBe("empty-key-value");
    expect(cache.has("")).toBe(true);
    expect(cache.delete("")).toBe(true);
    expect(cache.get("")).toBeNull();
    cache.destroy();
  });

  it("handles empty string value", () => {
    const cache = new NativeCache(100);
    expect(cache.put("key", "")).toBe(true);
    expect(cache.get("key")).toBe("");
    cache.destroy();
  });

  it("handles large value near MAX_VALUE_SIZE", () => {
    const cache = new NativeCache(10);
    // 1 MB value — well within MAX_VALUE_SIZE (4 MB) but large enough to stress
    const largeValue = "x".repeat(1024 * 1024);
    expect(cache.put("big", largeValue)).toBe(true);
    expect(cache.get("big")).toBe(largeValue);
    cache.destroy();
  });

  it("survives repeated create/destroy cycles", () => {
    for (let i = 0; i < 50; i++) {
      const cache = new NativeCache(10);
      cache.put("key", `value-${i}`);
      expect(cache.get("key")).toBe(`value-${i}`);
      cache.destroy();
    }
  });

  it("double destroy does not crash", () => {
    const cache = new NativeCache(10);
    cache.put("k", "v");
    cache.destroy();
    // Second destroy should be a no-op (idempotent)
    expect(() => cache.destroy()).not.toThrow();
  });

  it("throws on operations after destroy", () => {
    const cache = new NativeCache(10);
    cache.destroy();
    expect(() => cache.put("k", "v")).toThrow("destroyed");
    expect(() => cache.get("k")).toThrow("destroyed");
    expect(() => cache.has("k")).toThrow("destroyed");
    expect(() => cache.delete("k")).toThrow("destroyed");
    expect(() => cache.count()).toThrow("destroyed");
    expect(() => cache.clear()).toThrow("destroyed");
    expect(() => cache.getStats()).toThrow("destroyed");
  });

  it("handles multi-byte UTF-8 keys", () => {
    const cache = new NativeCache(100);
    const key = "日本語キー";
    const value = "Ünïcödé väluë 🎉";
    cache.put(key, value);
    expect(cache.get(key)).toBe(value);
    cache.destroy();
  });
});

// ── NativeBloomFilter boundary cases ───────────────────────

describe("NativeBloomFilter — boundary cases", () => {
  it("survives repeated create/destroy", () => {
    for (let i = 0; i < 50; i++) {
      const bf = new NativeBloomFilter(1024, 3);
      bf.add(`item-${i}`);
      expect(bf.check(`item-${i}`)).toBe(true);
      bf.destroy();
    }
  });

  it("double destroy does not crash", () => {
    const bf = new NativeBloomFilter(1024, 3);
    bf.destroy();
    expect(() => bf.destroy()).not.toThrow();
  });

  it("throws on operations after destroy", () => {
    const bf = new NativeBloomFilter(1024, 3);
    bf.destroy();
    expect(() => bf.add("x")).toThrow("destroyed");
    expect(() => bf.check("x")).toThrow("destroyed");
    expect(() => bf.count()).toThrow("destroyed");
    expect(() => bf.clear()).toThrow("destroyed");
  });

  it("handles empty string data", () => {
    const bf = new NativeBloomFilter(4096, 5);
    // Empty string add/check should not crash
    bf.add("");
    // Empty string check behavior is defined (returns false per zero-length guard)
    bf.destroy();
  });
});

// ── Compression boundary cases ─────────────────────────────

describe("Compression — boundary cases", () => {
  it("roundtrips single byte", () => {
    const data = new Uint8Array([42]);
    const compressed = compress(data);
    const decompressed = decompress(compressed);
    expect(Array.from(decompressed)).toEqual([42]);
  });

  it("roundtrips maximum run length (255 identical bytes)", () => {
    const data = new Uint8Array(255).fill(0xAA);
    const compressed = compress(data);
    const decompressed = decompress(compressed);
    expect(decompressed.length).toBe(255);
    expect(decompressed.every((b) => b === 0xAA)).toBe(true);
  });

  it("handles all-0xFF input", () => {
    const data = new Uint8Array(10).fill(0xFF);
    const compressed = compress(data);
    const decompressed = decompress(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(data));
  });
});

// ── NativeStats boundary cases ─────────────────────────────

describe("NativeStats — boundary cases", () => {
  it("returns 0 for empty data", () => {
    expect(NativeStats.mean([])).toBe(0);
    expect(NativeStats.min([])).toBe(0);
    expect(NativeStats.max([])).toBe(0);
    expect(NativeStats.median([])).toBe(0);
    expect(NativeStats.stdDev([])).toBe(0);
    expect(NativeStats.variance([])).toBe(0);
    expect(NativeStats.percentile([], 50)).toBe(0);
  });

  it("handles single-element data", () => {
    expect(NativeStats.mean([42])).toBe(42);
    expect(NativeStats.min([42])).toBe(42);
    expect(NativeStats.max([42])).toBe(42);
    expect(NativeStats.median([42])).toBe(42);
    // variance and stdDev with < 2 elements should return 0
    expect(NativeStats.variance([42])).toBe(0);
    expect(NativeStats.stdDev([42])).toBe(0);
  });

  it("histogram with zero buckets returns empty", () => {
    const result = NativeStats.histogram([1, 2, 3], 0);
    expect(result.length).toBe(0);
  });

  it("histogram with empty data returns zeroed buckets", () => {
    const result = NativeStats.histogram([], 5);
    expect(result.length).toBe(5);
    expect(result.every((c) => c === 0)).toBe(true);
  });
});
