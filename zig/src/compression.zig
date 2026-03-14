// ── Compression ────────────────────────────────────────────
// Simple Run-Length Encoding for byte sequences.
// Format: literal bytes pass through; runs of 3+ identical bytes
// are encoded as [0xFF][count][byte]. A literal 0xFF is escaped
// as [0xFF][1][0xFF].

pub const CompressionError = error{
    BufferTooSmall,
    InvalidData,
};

pub fn rleCompress(src: []const u8, dst: []u8) CompressionError!u32 {
    if (src.len == 0) return 0;

    var si: usize = 0;
    var di: usize = 0;

    while (si < src.len) {
        const current = src[si];
        var run_len: usize = 1;

        while (si + run_len < src.len and src[si + run_len] == current and run_len < 255) {
            run_len += 1;
        }

        if (run_len >= 3) {
            if (di + 3 > dst.len) return CompressionError.BufferTooSmall;
            dst[di] = 0xFF;
            dst[di + 1] = @intCast(run_len);
            dst[di + 2] = current;
            di += 3;
            si += run_len;
        } else if (current == 0xFF) {
            // Escape literal 0xFF bytes one at a time
            if (di + 3 > dst.len) return CompressionError.BufferTooSmall;
            dst[di] = 0xFF;
            dst[di + 1] = 1;
            dst[di + 2] = 0xFF;
            di += 3;
            si += 1;
        } else {
            if (di + 1 > dst.len) return CompressionError.BufferTooSmall;
            dst[di] = current;
            di += 1;
            si += 1;
        }
    }

    return @intCast(di);
}

pub fn rleDecompress(src: []const u8, dst: []u8) CompressionError!u32 {
    var si: usize = 0;
    var di: usize = 0;

    while (si < src.len) {
        if (src[si] == 0xFF) {
            if (si + 2 >= src.len) return CompressionError.InvalidData;
            const run_count: usize = src[si + 1];
            const byte = src[si + 2];
            if (di + run_count > dst.len) return CompressionError.BufferTooSmall;
            @memset(dst[di..][0..run_count], byte);
            di += run_count;
            si += 3;
        } else {
            if (di + 1 > dst.len) return CompressionError.BufferTooSmall;
            dst[di] = src[si];
            di += 1;
            si += 1;
        }
    }

    return @intCast(di);
}
