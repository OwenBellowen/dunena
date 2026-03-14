// ── Bloom Filter ───────────────────────────────────────────
// Probabilistic set membership using double-hashing (FNV-1a + djb2).
// No false negatives, tunable false-positive rate via size and hash count.

const std = @import("std");
const Allocator = std.mem.Allocator;

pub const BloomFilter = struct {
    bits: []u8,
    num_bits: u32,
    num_hashes: u8,
    allocator: Allocator,
    items_added: u64 = 0,

    pub fn init(allocator: Allocator, num_bits: u32, num_hashes: u8) !*BloomFilter {
        const self = try allocator.create(BloomFilter);
        const byte_count = (num_bits + 7) / 8;
        const bits = try allocator.alloc(u8, byte_count);
        @memset(bits, 0);
        self.* = .{
            .bits = bits,
            .num_bits = num_bits,
            .num_hashes = num_hashes,
            .allocator = allocator,
        };
        return self;
    }

    pub fn deinit(self: *BloomFilter) void {
        self.allocator.free(self.bits);
        self.allocator.destroy(self);
    }

    // ── Hash functions ─────────────────────────────────────

    fn fnv1a(data: []const u8) u64 {
        var h: u64 = 0xcbf29ce484222325;
        for (data) |byte| {
            h ^= byte;
            h *%= 0x100000001b3;
        }
        return h;
    }

    fn djb2(data: []const u8) u64 {
        var h: u64 = 5381;
        for (data) |byte| {
            h = ((h << 5) +% h) +% byte;
        }
        return h;
    }

    // ── Bit manipulation ───────────────────────────────────

    fn getBit(self: *const BloomFilter, idx: u32) bool {
        const byte_idx = idx / 8;
        const bit_idx: u3 = @intCast(idx % 8);
        return (self.bits[byte_idx] & (@as(u8, 1) << bit_idx)) != 0;
    }

    fn setBit(self: *BloomFilter, idx: u32) void {
        const byte_idx = idx / 8;
        const bit_idx: u3 = @intCast(idx % 8);
        self.bits[byte_idx] |= (@as(u8, 1) << bit_idx);
    }

    // ── Public API ─────────────────────────────────────────

    pub fn add(self: *BloomFilter, data: []const u8) void {
        const h1 = fnv1a(data);
        const h2 = djb2(data);
        var i: u8 = 0;
        while (i < self.num_hashes) : (i += 1) {
            const combined = h1 +% (@as(u64, i) *% h2);
            const idx: u32 = @intCast(combined % self.num_bits);
            self.setBit(idx);
        }
        self.items_added += 1;
    }

    pub fn check(self: *const BloomFilter, data: []const u8) bool {
        const h1 = fnv1a(data);
        const h2 = djb2(data);
        var i: u8 = 0;
        while (i < self.num_hashes) : (i += 1) {
            const combined = h1 +% (@as(u64, i) *% h2);
            const idx: u32 = @intCast(combined % self.num_bits);
            if (!self.getBit(idx)) return false;
        }
        return true;
    }

    pub fn clear(self: *BloomFilter) void {
        @memset(self.bits, 0);
        self.items_added = 0;
    }

    pub fn estimatedFPR(self: *const BloomFilter) f64 {
        const k: f64 = @floatFromInt(self.num_hashes);
        const n: f64 = @floatFromInt(self.items_added);
        const m: f64 = @floatFromInt(self.num_bits);
        const exp_val = @exp(-k * n / m);
        return std.math.pow(f64, 1.0 - exp_val, k);
    }
};
