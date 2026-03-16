// ── Bun FFI bindings to the Zig shared library ────────────
//
// Return code conventions (i32):
//   0  = success
//  -1  = error (invalid handle, key not found, or operation failed)
//  -2  = output buffer too small (cache_get only)
// Positive i32 = byte count written (cache_get, compress, decompress)
//
// Handle semantics (usize / ptr):
//   Non-zero = valid handle
//   0 / null = allocation failed — caller must check before use
//
import { dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync } from "fs";
import { resolve, join } from "path";

function findLibrary(): string {
  const base = resolve(import.meta.dir, "../../../../zig/zig-out");
  const candidates = [
    join(base, `lib/libdunena.${suffix}`),
    join(base, `lib/dunena.${suffix}`),
    join(base, `bin/dunena.${suffix}`),
    join(base, `bin/libdunena.${suffix}`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    [
      "Dunena native library not found.",
      `Searched in: ${base}`,
      "Run 'bun run build:zig' to compile the Zig core first.",
    ].join("\n")
  );
}

const lib = dlopen(findLibrary(), {
  // ── Cache ────────────────────────────────────────────────
  dunena_cache_create: {
    args: [FFIType.u32],
    returns: FFIType.ptr,
  },
  dunena_cache_destroy: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  dunena_cache_put: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  dunena_cache_get: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  dunena_cache_delete: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  dunena_cache_contains: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  dunena_cache_count: {
    args: [FFIType.ptr],
    returns: FFIType.u32,
  },
  dunena_cache_clear: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  dunena_cache_stats: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },

  // ── Bloom Filter ─────────────────────────────────────────
  dunena_bloom_create: {
    args: [FFIType.u32, FFIType.u8],
    returns: FFIType.ptr,
  },
  dunena_bloom_destroy: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  dunena_bloom_add: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.void,
  },
  dunena_bloom_check: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  dunena_bloom_clear: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  dunena_bloom_count: {
    args: [FFIType.ptr],
    returns: FFIType.u64,
  },

  // ── Compression ──────────────────────────────────────────
  dunena_compress: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  dunena_decompress: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },

  // ── Stats ────────────────────────────────────────────────
  dunena_stats_mean: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.f64,
  },
  dunena_stats_variance: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.f64,
  },
  dunena_stats_std_dev: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.f64,
  },
  dunena_stats_min: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.f64,
  },
  dunena_stats_max: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.f64,
  },
  dunena_stats_percentile: {
    args: [FFIType.ptr, FFIType.u32, FFIType.f64],
    returns: FFIType.f64,
  },
  dunena_stats_median: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.f64,
  },
  dunena_stats_histogram: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
    returns: FFIType.void,
  },
});

export const symbols = lib.symbols;
export default lib;
