// ── Dunena Cache Engine ────────────────────────────────────
// LRU cache backed by a hash map and a doubly-linked list.
// All keys and values are arbitrary byte slices; the cache
// owns copies of both and frees them on eviction / destroy.

const std = @import("std");
const Allocator = std.mem.Allocator;

pub const CacheEntry = struct {
    key: []u8,
    value: []u8,
    prev: ?*CacheEntry = null,
    next: ?*CacheEntry = null,
    created_at_ns: i128,
};

pub const CacheStats = struct {
    hits: u64 = 0,
    misses: u64 = 0,
    evictions: u64 = 0,
    puts: u64 = 0,
    deletes: u64 = 0,
    current_size: u64 = 0,
    max_size: u64 = 0,
};

pub const Cache = struct {
    allocator: Allocator,
    map: std.StringHashMap(*CacheEntry),
    head: ?*CacheEntry = null, // most-recently used
    tail: ?*CacheEntry = null, // least-recently used
    max_entries: u32,
    stats: CacheStats,

    // ── Lifecycle ──────────────────────────────────────────

    pub fn init(allocator: Allocator, max_entries: u32) !*Cache {
        const self = try allocator.create(Cache);
        self.* = .{
            .allocator = allocator,
            .map = std.StringHashMap(*CacheEntry).init(allocator),
            .max_entries = max_entries,
            .stats = CacheStats{ .max_size = max_entries },
        };
        return self;
    }

    pub fn deinit(self: *Cache) void {
        self.freeAllEntries();
        self.map.deinit();
        self.allocator.destroy(self);
    }

    // ── Core Operations ────────────────────────────────────

    pub fn put(self: *Cache, key: []const u8, value: []const u8) !void {
        self.stats.puts += 1;

        if (self.map.get(key)) |existing| {
            self.allocator.free(existing.value);
            existing.value = try self.allocator.dupe(u8, value);
            self.detach(existing);
            self.pushFront(existing);
            return;
        }

        while (self.stats.current_size >= self.max_entries) {
            self.evictOne();
        }

        const entry = try self.allocator.create(CacheEntry);
        const key_copy = try self.allocator.dupe(u8, key);
        const val_copy = try self.allocator.dupe(u8, value);
        entry.* = .{
            .key = key_copy,
            .value = val_copy,
            .created_at_ns = std.time.nanoTimestamp(),
        };
        try self.map.put(key_copy, entry);
        self.pushFront(entry);
        self.stats.current_size += 1;
    }

    pub fn get(self: *Cache, key: []const u8) ?[]const u8 {
        if (self.map.get(key)) |entry| {
            self.stats.hits += 1;
            self.detach(entry);
            self.pushFront(entry);
            return entry.value;
        }
        self.stats.misses += 1;
        return null;
    }

    pub fn delete(self: *Cache, key: []const u8) bool {
        const kv = self.map.fetchRemove(key) orelse return false;
        const entry = kv.value;
        self.detach(entry);
        self.allocator.free(entry.key);
        self.allocator.free(entry.value);
        self.allocator.destroy(entry);
        self.stats.current_size -= 1;
        self.stats.deletes += 1;
        return true;
    }

    pub fn contains(self: *Cache, key: []const u8) bool {
        return self.map.contains(key);
    }

    pub fn count(self: *Cache) u32 {
        return @intCast(self.stats.current_size);
    }

    pub fn clear(self: *Cache) void {
        self.freeAllEntries();
        self.map.clearAndFree();
        self.head = null;
        self.tail = null;
        self.stats.current_size = 0;
    }

    pub fn getStats(self: *Cache) CacheStats {
        return self.stats;
    }

    // ── Linked-list helpers ────────────────────────────────

    fn detach(self: *Cache, entry: *CacheEntry) void {
        if (entry.prev) |p| {
            p.next = entry.next;
        } else {
            self.head = entry.next;
        }
        if (entry.next) |n| {
            n.prev = entry.prev;
        } else {
            self.tail = entry.prev;
        }
        entry.prev = null;
        entry.next = null;
    }

    fn pushFront(self: *Cache, entry: *CacheEntry) void {
        entry.prev = null;
        entry.next = self.head;
        if (self.head) |h| h.prev = entry;
        self.head = entry;
        if (self.tail == null) self.tail = entry;
    }

    fn evictOne(self: *Cache) void {
        const victim = self.tail orelse return;
        self.detach(victim);
        _ = self.map.remove(victim.key);
        self.allocator.free(victim.key);
        self.allocator.free(victim.value);
        self.allocator.destroy(victim);
        self.stats.evictions += 1;
        self.stats.current_size -= 1;
    }

    fn freeAllEntries(self: *Cache) void {
        var node = self.head;
        while (node) |n| {
            const next = n.next;
            self.allocator.free(n.key);
            self.allocator.free(n.value);
            self.allocator.destroy(n);
            node = next;
        }
        self.head = null;
        self.tail = null;
    }
};
