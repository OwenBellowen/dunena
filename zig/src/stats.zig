// ── Statistics Engine ───────────────────────────────────────
// Pure numeric computations on f64 slices: mean, variance,
// standard deviation, min, max, percentile, median, histogram.

const std = @import("std");
const Allocator = std.mem.Allocator;

pub fn mean(data: []const f64) f64 {
    if (data.len == 0) return 0;
    var sum: f64 = 0;
    for (data) |v| sum += v;
    return sum / @as(f64, @floatFromInt(data.len));
}

pub fn variance(data: []const f64) f64 {
    if (data.len < 2) return 0;
    const m = mean(data);
    var sum_sq: f64 = 0;
    for (data) |v| {
        const diff = v - m;
        sum_sq += diff * diff;
    }
    return sum_sq / @as(f64, @floatFromInt(data.len - 1));
}

pub fn stdDev(data: []const f64) f64 {
    return @sqrt(variance(data));
}

pub fn min(data: []const f64) f64 {
    if (data.len == 0) return 0;
    var m = data[0];
    for (data[1..]) |v| {
        if (v < m) m = v;
    }
    return m;
}

pub fn max(data: []const f64) f64 {
    if (data.len == 0) return 0;
    var m = data[0];
    for (data[1..]) |v| {
        if (v > m) m = v;
    }
    return m;
}

fn sortAsc(values: []f64) void {
    if (values.len <= 1) return;
    std.sort.pdq(f64, values, {}, std.sort.asc(f64));
}

/// Compute a single percentile from a pre-sorted slice (no allocation).
fn percentileFromSorted(sorted: []const f64, p: f64) f64 {
    if (sorted.len == 0) return 0;
    if (sorted.len == 1) return sorted[0];

    const rank = (p / 100.0) * @as(f64, @floatFromInt(sorted.len - 1));
    const lower: usize = @intFromFloat(@floor(rank));
    const upper: usize = @intFromFloat(@ceil(rank));

    if (lower == upper) return sorted[lower];

    const frac = rank - @as(f64, @floatFromInt(lower));
    return sorted[lower] * (1.0 - frac) + sorted[upper] * frac;
}

pub fn percentile(allocator: Allocator, data: []const f64, p: f64) !f64 {
    if (data.len == 0) return 0;
    if (data.len == 1) return data[0];

    const sorted = try allocator.dupe(f64, data);
    defer allocator.free(sorted);
    sortAsc(sorted);

    return percentileFromSorted(sorted, p);
}

/// Compute multiple percentiles with a single sort.  Caller provides
/// a slice of percentile values (e.g. [50, 95, 99]) and a results
/// slice of the same length.  Both slices must have identical length.
pub fn multiPercentile(
    allocator: Allocator,
    data: []const f64,
    percentiles: []const f64,
    results: []f64,
) !void {
    if (data.len == 0) {
        @memset(results, 0);
        return;
    }

    const sorted = try allocator.dupe(f64, data);
    defer allocator.free(sorted);
    sortAsc(sorted);

    for (percentiles, 0..) |p, i| {
        results[i] = percentileFromSorted(sorted, p);
    }
}

pub fn median(allocator: Allocator, data: []const f64) !f64 {
    return percentile(allocator, data, 50.0);
}

pub fn histogram(data: []const f64, bucket_count: u32, out_counts: []u32) void {
    if (data.len == 0 or bucket_count == 0) return;

    const min_val = min(data);
    const max_val = max(data);
    const range = max_val - min_val;

    @memset(out_counts[0..bucket_count], 0);

    if (range == 0) {
        out_counts[0] = @intCast(data.len);
        return;
    }

    const bucket_width = range / @as(f64, @floatFromInt(bucket_count));

    for (data) |v| {
        var bucket: usize = @intFromFloat((v - min_val) / bucket_width);
        if (bucket >= bucket_count) bucket = bucket_count - 1;
        out_counts[bucket] += 1;
    }
}
