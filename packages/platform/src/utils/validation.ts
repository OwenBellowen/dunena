// ── Input Validation ───────────────────────────────────────

const MAX_KEY_LENGTH = 512;
const MAX_VALUE_SIZE = 4 * 1024 * 1024; // 4 MB
const KEY_PATTERN = /^[\x20-\x7E]+$/; // printable ASCII

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateKey(key: unknown): ValidationResult {
  if (typeof key !== "string") {
    return { valid: false, error: "Key must be a string" };
  }
  if (key.length === 0) {
    return { valid: false, error: "Key must not be empty" };
  }
  if (key.length > MAX_KEY_LENGTH) {
    return { valid: false, error: `Key exceeds max length (${MAX_KEY_LENGTH})` };
  }
  if (!KEY_PATTERN.test(key)) {
    return { valid: false, error: "Key contains invalid characters" };
  }
  return { valid: true };
}

export function validateValue(value: unknown): ValidationResult {
  if (typeof value !== "string") {
    return { valid: false, error: "Value must be a string" };
  }
  const byteLen = new TextEncoder().encode(value).length;
  if (byteLen > MAX_VALUE_SIZE) {
    return {
      valid: false,
      error: `Value exceeds max size (${MAX_VALUE_SIZE} bytes)`,
    };
  }
  return { valid: true };
}

export function validateTTL(ttl: unknown): ValidationResult {
  if (ttl === undefined || ttl === null) return { valid: true };
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 0) {
    return { valid: false, error: "TTL must be a non-negative integer (ms)" };
  }
  return { valid: true };
}

export function validationError(msg: string): Response {
  return Response.json({ error: msg }, { status: 400 });
}
