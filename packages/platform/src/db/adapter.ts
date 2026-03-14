// ── Storage Adapter Interface ──────────────────────────────
// Pluggable backend for durable key-value storage. The in-memory
// Zig cache is fast but volatile — adapters provide persistence
// and can be swapped between SQLite, PostgreSQL, Redis, etc.

export interface StorageEntry {
  key: string;
  value: string;
  namespace: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  tags: string[];
}

export interface StorageQueryOptions {
  namespace?: string;
  prefix?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  orderBy?: "key" | "createdAt" | "updatedAt";
  order?: "asc" | "desc";
}

export interface StorageStats {
  backend: string;
  totalEntries: number;
  totalNamespaces: number;
  dbSizeBytes: number;
}

/**
 * Abstract storage adapter. All adapters must implement these
 * methods. The cache service can optionally write-through or
 * read-through via any adapter.
 */
export interface StorageAdapter {
  readonly name: string;

  // ── Core CRUD ────────────────────────────────────────────
  get(key: string, namespace?: string): Promise<StorageEntry | null>;
  set(key: string, value: string, options?: {
    namespace?: string;
    ttl?: number;
    tags?: string[];
  }): Promise<boolean>;
  delete(key: string, namespace?: string): Promise<boolean>;
  has(key: string, namespace?: string): Promise<boolean>;

  // ── Batch ────────────────────────────────────────────────
  mget(keys: string[], namespace?: string): Promise<Record<string, StorageEntry | null>>;
  mset(entries: Array<{
    key: string;
    value: string;
    ttl?: number;
    tags?: string[];
  }>, namespace?: string): Promise<number>;
  mdelete(keys: string[], namespace?: string): Promise<number>;

  // ── Query ────────────────────────────────────────────────
  query(options: StorageQueryOptions): Promise<StorageEntry[]>;
  count(namespace?: string): Promise<number>;
  keys(pattern?: string, namespace?: string): Promise<string[]>;

  // ── Tag invalidation ─────────────────────────────────────
  deleteByTags(tags: string[], namespace?: string): Promise<number>;

  // ── Management ───────────────────────────────────────────
  clear(namespace?: string): Promise<void>;
  stats(): Promise<StorageStats>;
  close(): Promise<void>;

  // ── Expiry cleanup ───────────────────────────────────────
  purgeExpired(): Promise<number>;
}
