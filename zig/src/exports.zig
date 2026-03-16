// ── Dunena C-ABI Exports ───────────────────────────────────
// Every exported symbol uses the `export` keyword (C calling
// convention).  Handles are passed as `usize` so the TypeScript
// FFI layer can treat them as opaque numbers.

const std = @import("std");
const cache_mod = @import("cache.zig");
const bloom_mod = @import("bloom_filter.zig");
const compress_mod = @import("compression.zig");
const stats_mod = @import("stats.zig");

const Cache = cache_mod.Cache;
const BloomFilter = bloom_mod.BloomFilter;

const allocator = std.heap.page_allocator;

// ════════════════════════════════════════════════════════════
//  Cache
//
//  Handle lifecycle: create returns a non-zero usize handle on
//  success, 0 on allocation failure. All subsequent calls pass
//  this handle. Passing 0 is safe (early-returns / returns error).
//  destroy frees all resources; the handle is invalid after that.
//
//  Return codes (i32):
//    0  = success
//   -1  = invalid handle or key-not-found
//   -2  = output buffer too small (cache_get only)
// ════════════════════════════════════════════════════════════

export fn dunena_cache_create(max_entries: u32) usize {
    const c = Cache.init(allocator, max_entries) catch return 0;
    return @intFromPtr(c);
}

export fn dunena_cache_destroy(handle: usize) void {
    if (handle == 0) return;
    const c: *Cache = @ptrFromInt(handle);
    c.deinit();
}

export fn dunena_cache_put(
    handle: usize,
    key_ptr: [*]const u8,
    key_len: u32,
    val_ptr: [*]const u8,
    val_len: u32,
) i32 {
    if (handle == 0) return -1;
    const c: *Cache = @ptrFromInt(handle);
    c.put(key_ptr[0..key_len], val_ptr[0..val_len]) catch return -1;
    return 0;
}

export fn dunena_cache_get(
    handle: usize,
    key_ptr: [*]const u8,
    key_len: u32,
    out_buf: [*]u8,
    out_cap: u32,
) i32 {
    if (handle == 0) return -1;
    const c: *Cache = @ptrFromInt(handle);
    const value = c.get(key_ptr[0..key_len]) orelse return -1;
    if (value.len > out_cap) return -2; // buffer too small
    @memcpy(out_buf[0..value.len], value);
    return @intCast(value.len);
}

export fn dunena_cache_delete(
    handle: usize,
    key_ptr: [*]const u8,
    key_len: u32,
) i32 {
    if (handle == 0) return -1;
    const c: *Cache = @ptrFromInt(handle);
    return if (c.delete(key_ptr[0..key_len])) @as(i32, 0) else @as(i32, -1);
}

export fn dunena_cache_contains(
    handle: usize,
    key_ptr: [*]const u8,
    key_len: u32,
) i32 {
    if (handle == 0) return 0;
    const c: *Cache = @ptrFromInt(handle);
    return if (c.contains(key_ptr[0..key_len])) @as(i32, 1) else @as(i32, 0);
}

export fn dunena_cache_count(handle: usize) u32 {
    if (handle == 0) return 0;
    const c: *Cache = @ptrFromInt(handle);
    return c.count();
}

export fn dunena_cache_clear(handle: usize) void {
    if (handle == 0) return;
    const c: *Cache = @ptrFromInt(handle);
    c.clear();
}

/// Writes 7 × u64 into `out`: hits, misses, evictions, puts,
/// deletes, current_size, max_size.
export fn dunena_cache_stats(handle: usize, out: [*]u64) void {
    if (handle == 0) return;
    const c: *Cache = @ptrFromInt(handle);
    const s = c.stats;
    out[0] = s.hits;
    out[1] = s.misses;
    out[2] = s.evictions;
    out[3] = s.puts;
    out[4] = s.deletes;
    out[5] = s.current_size;
    out[6] = s.max_size;
}

// ════════════════════════════════════════════════════════════
//  Bloom Filter
//
//  Same handle lifecycle as Cache.  add/check accept a
//  (data_ptr, data_len) pair.  Zero-length data is a no-op for
//  add, and returns 0 (not-found) for check.
// ════════════════════════════════════════════════════════════

export fn dunena_bloom_create(num_bits: u32, num_hashes: u8) usize {
    const bf = BloomFilter.init(allocator, num_bits, num_hashes) catch return 0;
    return @intFromPtr(bf);
}

export fn dunena_bloom_destroy(handle: usize) void {
    if (handle == 0) return;
    const bf: *BloomFilter = @ptrFromInt(handle);
    bf.deinit();
}

export fn dunena_bloom_add(handle: usize, data_ptr: [*]const u8, data_len: u32) void {
    if (handle == 0) return;
    if (data_len == 0) return; // zero-length data is a no-op
    const bf: *BloomFilter = @ptrFromInt(handle);
    bf.add(data_ptr[0..data_len]);
}

export fn dunena_bloom_check(handle: usize, data_ptr: [*]const u8, data_len: u32) i32 {
    if (handle == 0) return 0;
    if (data_len == 0) return 0; // zero-length data is never found
    const bf: *BloomFilter = @ptrFromInt(handle);
    return if (bf.check(data_ptr[0..data_len])) @as(i32, 1) else @as(i32, 0);
}

export fn dunena_bloom_clear(handle: usize) void {
    if (handle == 0) return;
    const bf: *BloomFilter = @ptrFromInt(handle);
    bf.clear();
}

export fn dunena_bloom_count(handle: usize) u64 {
    if (handle == 0) return 0;
    const bf: *BloomFilter = @ptrFromInt(handle);
    return bf.items_added;
}

// ════════════════════════════════════════════════════════════
//  Compression
//
//  Returns the number of bytes written to dst on success,
//  or -1 on failure (buffer too small / invalid data).
// ════════════════════════════════════════════════════════════

export fn dunena_compress(
    src_ptr: [*]const u8,
    src_len: u32,
    dst_ptr: [*]u8,
    dst_cap: u32,
) i32 {
    const result = compress_mod.rleCompress(
        src_ptr[0..src_len],
        dst_ptr[0..dst_cap],
    ) catch return -1;
    return @intCast(result);
}

export fn dunena_decompress(
    src_ptr: [*]const u8,
    src_len: u32,
    dst_ptr: [*]u8,
    dst_cap: u32,
) i32 {
    const result = compress_mod.rleDecompress(
        src_ptr[0..src_len],
        dst_ptr[0..dst_cap],
    ) catch return -1;
    return @intCast(result);
}

// ════════════════════════════════════════════════════════════
//  Statistics
//
//  All stats functions accept (data_ptr, len).  Passing len=0
//  returns 0.0 for all scalar functions and is a no-op for
//  histogram.
// ════════════════════════════════════════════════════════════

export fn dunena_stats_mean(data_ptr: [*]const f64, len: u32) f64 {
    if (len == 0) return 0;
    return stats_mod.mean(data_ptr[0..len]);
}

export fn dunena_stats_variance(data_ptr: [*]const f64, len: u32) f64 {
    if (len < 2) return 0;
    return stats_mod.variance(data_ptr[0..len]);
}

export fn dunena_stats_std_dev(data_ptr: [*]const f64, len: u32) f64 {
    if (len < 2) return 0;
    return stats_mod.stdDev(data_ptr[0..len]);
}

export fn dunena_stats_min(data_ptr: [*]const f64, len: u32) f64 {
    if (len == 0) return 0;
    return stats_mod.min(data_ptr[0..len]);
}

export fn dunena_stats_max(data_ptr: [*]const f64, len: u32) f64 {
    if (len == 0) return 0;
    return stats_mod.max(data_ptr[0..len]);
}

export fn dunena_stats_percentile(data_ptr: [*]const f64, len: u32, p: f64) f64 {
    if (len == 0) return 0;
    return stats_mod.percentile(allocator, data_ptr[0..len], p) catch 0;
}

export fn dunena_stats_median(data_ptr: [*]const f64, len: u32) f64 {
    if (len == 0) return 0;
    return stats_mod.median(allocator, data_ptr[0..len]) catch 0;
}

export fn dunena_stats_histogram(
    data_ptr: [*]const f64,
    len: u32,
    bucket_count: u32,
    out_counts: [*]u32,
) void {
    if (len == 0 or bucket_count == 0) return;
    stats_mod.histogram(data_ptr[0..len], bucket_count, out_counts[0..bucket_count]);
}

/// Compute multiple percentiles with one sort.  `percentiles_ptr` and
/// `results_ptr` must both have `percentiles_len` elements.
export fn dunena_stats_multi_percentile(
    data_ptr: [*]const f64,
    len: u32,
    percentiles_ptr: [*]const f64,
    percentiles_len: u32,
    results_ptr: [*]f64,
) void {
    if (len == 0 or percentiles_len == 0) {
        @memset(results_ptr[0..percentiles_len], 0);
        return;
    }
    stats_mod.multiPercentile(
        allocator,
        data_ptr[0..len],
        percentiles_ptr[0..percentiles_len],
        results_ptr[0..percentiles_len],
    ) catch {
        @memset(results_ptr[0..percentiles_len], 0);
    };
}

// ════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════

test "cache basic operations" {
    const c = try Cache.init(std.testing.allocator, 10);
    defer c.deinit();

    try c.put("hello", "world");
    const val = c.get("hello") orelse return error.TestFailed;
    try std.testing.expectEqualStrings("world", val);
    try std.testing.expect(c.delete("hello"));
    try std.testing.expect(c.get("hello") == null);
}

test "cache LRU eviction" {
    const c = try Cache.init(std.testing.allocator, 3);
    defer c.deinit();

    try c.put("a", "1");
    try c.put("b", "2");
    try c.put("c", "3");
    // Access "a" so it becomes most-recently used
    _ = c.get("a");
    // Insert "d" – should evict "b" (the LRU)
    try c.put("d", "4");

    try std.testing.expect(c.get("b") == null);
    try std.testing.expect(c.get("a") != null);
    try std.testing.expect(c.get("d") != null);
}

test "cache update existing key" {
    const c = try Cache.init(std.testing.allocator, 10);
    defer c.deinit();

    try c.put("key", "value1");
    try c.put("key", "value2");
    const val = c.get("key") orelse return error.TestFailed;
    try std.testing.expectEqualStrings("value2", val);
    try std.testing.expectEqual(@as(u32, 1), c.count());
}

test "bloom filter basic" {
    const bf = try BloomFilter.init(std.testing.allocator, 4096, 5);
    defer bf.deinit();

    bf.add("hello");
    bf.add("world");
    bf.add("dunena");

    try std.testing.expect(bf.check("hello"));
    try std.testing.expect(bf.check("world"));
    try std.testing.expect(bf.check("dunena"));
    try std.testing.expectEqual(@as(u64, 3), bf.items_added);
}

test "compression roundtrip" {
    const input = "AAAAAABBBBCCCCCCDDDDDD";
    var compressed: [256]u8 = undefined;
    const clen = try compress_mod.rleCompress(input, &compressed);

    var decompressed: [256]u8 = undefined;
    const dlen = try compress_mod.rleDecompress(compressed[0..clen], &decompressed);

    try std.testing.expectEqualStrings(input, decompressed[0..dlen]);
}

test "compression 0xFF escape" {
    const input = [_]u8{ 0xFF, 0x42, 0xFF };
    var compressed: [64]u8 = undefined;
    const clen = try compress_mod.rleCompress(&input, &compressed);

    var decompressed: [64]u8 = undefined;
    const dlen = try compress_mod.rleDecompress(compressed[0..clen], &decompressed);

    try std.testing.expectEqualSlices(u8, &input, decompressed[0..dlen]);
}

test "stats basics" {
    const data = [_]f64{ 1, 2, 3, 4, 5 };
    try std.testing.expectApproxEqAbs(@as(f64, 3.0), stats_mod.mean(&data), 0.001);
    try std.testing.expectApproxEqAbs(@as(f64, 1.0), stats_mod.min(&data), 0.001);
    try std.testing.expectApproxEqAbs(@as(f64, 5.0), stats_mod.max(&data), 0.001);
}

test "stats percentile" {
    const data = [_]f64{ 10, 20, 30, 40, 50 };
    const p50 = try stats_mod.percentile(std.testing.allocator, &data, 50);
    try std.testing.expectApproxEqAbs(@as(f64, 30.0), p50, 0.001);
}
