// ── TypeScript wrappers around Zig FFI symbols ────────────
import { ptr, type Pointer } from "bun:ffi";
import { symbols } from "./ffi";
import type { CacheStats } from "../types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_VALUE_SIZE = 4 * 1024 * 1024; // 4 MB

// Bun's ptr() throws if given a 0-length Uint8Array.
// For empty strings, we pass a dummy 1-byte array and length 0.
const emptyBuf = new Uint8Array(1);
function encodeSafe(str: string): { buf: Uint8Array; len: number } {
  const data = encoder.encode(str);
  return {
    buf: data.length === 0 ? emptyBuf : data,
    len: data.length,
  };
}

// ── NativeCache ────────────────────────────────────────────

export class NativeCache {
  private handle: Pointer;
  private readBuffer = new Uint8Array(MAX_VALUE_SIZE);
  private destroyed = false;

  constructor(maxEntries: number) {
    const h = symbols.dunena_cache_create(maxEntries);
    if (!h) throw new Error("Failed to allocate native cache");
    this.handle = h;
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("Cache has been destroyed");
  }

  put(key: string, value: string): boolean {
    this.ensureAlive();
    const k = encodeSafe(key);
    const v = encodeSafe(value);
    return (
      (symbols.dunena_cache_put(
        this.handle,
        ptr(k.buf),
        k.len,
        ptr(v.buf),
        v.len
      ) as number) === 0
    );
  }

  get(key: string): string | null {
    this.ensureAlive();
    const k = encodeSafe(key);
    const len = symbols.dunena_cache_get(
      this.handle,
      ptr(k.buf),
      k.len,
      ptr(this.readBuffer),
      MAX_VALUE_SIZE
    ) as number;
    if (len < 0) return null;
    return decoder.decode(this.readBuffer.subarray(0, len));
  }

  delete(key: string): boolean {
    this.ensureAlive();
    const k = encodeSafe(key);
    return (
      (symbols.dunena_cache_delete(this.handle, ptr(k.buf), k.len) as number) ===
      0
    );
  }

  has(key: string): boolean {
    this.ensureAlive();
    const k = encodeSafe(key);
    return (
      (symbols.dunena_cache_contains(
        this.handle,
        ptr(k.buf),
        k.len
      ) as number) === 1
    );
  }

  count(): number {
    this.ensureAlive();
    return symbols.dunena_cache_count(this.handle) as number;
  }

  clear(): void {
    this.ensureAlive();
    symbols.dunena_cache_clear(this.handle);
  }

  getStats(): CacheStats {
    this.ensureAlive();
    const buf = new BigUint64Array(7);
    symbols.dunena_cache_stats(this.handle, ptr(buf));
    const hits = Number(buf[0]);
    const misses = Number(buf[1]);
    const total = hits + misses;
    return {
      hits,
      misses,
      evictions: Number(buf[2]),
      puts: Number(buf[3]),
      deletes: Number(buf[4]),
      currentSize: Number(buf[5]),
      maxSize: Number(buf[6]),
      hitRate: total > 0 ? hits / total : 0,
    };
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      symbols.dunena_cache_destroy(this.handle);
    }
  }
}

// ── NativeBloomFilter ──────────────────────────────────────

export class NativeBloomFilter {
  private handle: Pointer;
  private destroyed = false;

  constructor(numBits: number, numHashes: number) {
    const h = symbols.dunena_bloom_create(numBits, numHashes);
    if (!h) throw new Error("Failed to allocate bloom filter");
    this.handle = h;
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error("Bloom filter has been destroyed");
  }

  add(data: string): void {
    this.ensureAlive();
    const d = encodeSafe(data);
    symbols.dunena_bloom_add(this.handle, ptr(d.buf), d.len);
  }

  check(data: string): boolean {
    this.ensureAlive();
    const d = encodeSafe(data);
    return (
      (symbols.dunena_bloom_check(
        this.handle,
        ptr(d.buf),
        d.len
      ) as number) === 1
    );
  }

  clear(): void {
    this.ensureAlive();
    symbols.dunena_bloom_clear(this.handle);
  }

  count(): number {
    this.ensureAlive();
    return Number(symbols.dunena_bloom_count(this.handle));
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      symbols.dunena_bloom_destroy(this.handle);
    }
  }
}

// ── Compression helpers ────────────────────────────────────

export function compress(data: string | Uint8Array): Uint8Array {
  const src =
    typeof data === "string" ? encoder.encode(data) : data;
  if (src.length === 0) return new Uint8Array(0);
  const dst = new Uint8Array(src.length * 2 + 64);
  const len = symbols.dunena_compress(
    ptr(src),
    src.length,
    ptr(dst),
    dst.length
  ) as number;
  if (len < 0) throw new Error("Compression failed");
  return dst.slice(0, len);
}

export function decompress(
  data: Uint8Array,
  maxOutput = MAX_VALUE_SIZE
): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);
  const dst = new Uint8Array(maxOutput);
  const len = symbols.dunena_decompress(
    ptr(data),
    data.length,
    ptr(dst),
    dst.length
  ) as number;
  if (len < 0) throw new Error("Decompression failed");
  return dst.slice(0, len);
}

// ── NativeStats ────────────────────────────────────────────

export class NativeStats {
  static mean(data: number[]): number {
    if (data.length === 0) return 0;
    const buf = new Float64Array(data);
    return symbols.dunena_stats_mean(ptr(buf), data.length) as number;
  }

  static variance(data: number[]): number {
    if (data.length < 2) return 0;
    const buf = new Float64Array(data);
    return symbols.dunena_stats_variance(ptr(buf), data.length) as number;
  }

  static stdDev(data: number[]): number {
    if (data.length < 2) return 0;
    const buf = new Float64Array(data);
    return symbols.dunena_stats_std_dev(ptr(buf), data.length) as number;
  }

  static min(data: number[]): number {
    if (data.length === 0) return 0;
    const buf = new Float64Array(data);
    return symbols.dunena_stats_min(ptr(buf), data.length) as number;
  }

  static max(data: number[]): number {
    if (data.length === 0) return 0;
    const buf = new Float64Array(data);
    return symbols.dunena_stats_max(ptr(buf), data.length) as number;
  }

  static percentile(data: number[], p: number): number {
    if (data.length === 0) return 0;
    const buf = new Float64Array(data);
    return symbols.dunena_stats_percentile(
      ptr(buf),
      data.length,
      p
    ) as number;
  }

  static median(data: number[]): number {
    if (data.length === 0) return 0;
    const buf = new Float64Array(data);
    return symbols.dunena_stats_median(ptr(buf), data.length) as number;
  }

  static histogram(data: number[], bucketCount: number): number[] {
    if (data.length === 0 || bucketCount === 0) return new Array(bucketCount).fill(0);
    const dataBuf = new Float64Array(data);
    const countsBuf = new Uint32Array(bucketCount);
    symbols.dunena_stats_histogram(
      ptr(dataBuf),
      data.length,
      bucketCount,
      ptr(countsBuf)
    );
    return Array.from(countsBuf);
  }
}
