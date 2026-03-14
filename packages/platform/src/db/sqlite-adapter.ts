// ── SQLite Storage Adapter ──────────────────────────────────
// Durable key-value storage backed by Bun's built-in bun:sqlite.
// Zero external dependencies. Uses WAL mode for concurrent readers.

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type {
  StorageAdapter,
  StorageEntry,
  StorageQueryOptions,
  StorageStats,
} from "./adapter";
import { logger } from "../utils/logger";

const log = logger.child("sqlite");

export interface SQLiteAdapterOptions {
  path: string;           // file path, or ":memory:" for in-memory
  walMode?: boolean;      // default true — better concurrency
  busyTimeout?: number;   // ms to wait for lock, default 5000
}

export class SQLiteAdapter implements StorageAdapter {
  readonly name = "sqlite";
  private db: Database;
  private closed = false;

  constructor(options: SQLiteAdapterOptions) {
    this.db = new Database(options.path, { create: true });

    if (options.walMode !== false) {
      this.db.run("PRAGMA journal_mode = WAL");
    }
    this.db.run(`PRAGMA busy_timeout = ${options.busyTimeout ?? 5000}`);
    this.db.run("PRAGMA synchronous = NORMAL");
    this.db.run("PRAGMA cache_size = -8000"); // 8 MB

    this.createTables();
    log.info("SQLite adapter initialised", { path: options.path });
  }

  private createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv (
        key         TEXT     NOT NULL,
        namespace   TEXT     NOT NULL DEFAULT '',
        value       TEXT     NOT NULL,
        created_at  INTEGER  NOT NULL,
        updated_at  INTEGER  NOT NULL,
        expires_at  INTEGER,
        PRIMARY KEY (namespace, key)
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS kv_tags (
        namespace TEXT NOT NULL,
        key       TEXT NOT NULL,
        tag       TEXT NOT NULL,
        PRIMARY KEY (namespace, key, tag),
        FOREIGN KEY (namespace, key) REFERENCES kv(namespace, key) ON DELETE CASCADE
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv(expires_at) WHERE expires_at IS NOT NULL");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_kv_tags_tag ON kv_tags(tag)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_kv_ns ON kv(namespace)");
    // Enable foreign keys
    this.db.run("PRAGMA foreign_keys = ON");
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("SQLite adapter is closed");
  }

  private toEntry(row: Record<string, unknown>, tags?: string[]): StorageEntry {
    return {
      key: row.key as string,
      value: row.value as string,
      namespace: row.namespace as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      expiresAt: (row.expires_at as number | null) ?? null,
      tags: tags ?? [],
    };
  }

  private getTags(key: string, namespace: string): string[] {
    const rows = this.db
      .query("SELECT tag FROM kv_tags WHERE namespace = ?1 AND key = ?2")
      .all(namespace, key) as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  }

  private isExpired(row: Record<string, unknown>): boolean {
    const exp = row.expires_at as number | null;
    return exp !== null && exp <= Date.now();
  }

  // ── Core CRUD ────────────────────────────────────────────

  async get(key: string, namespace = ""): Promise<StorageEntry | null> {
    this.ensureOpen();
    const row = this.db
      .query("SELECT * FROM kv WHERE namespace = ?1 AND key = ?2")
      .get(namespace, key) as Record<string, unknown> | null;
    if (!row || this.isExpired(row)) {
      if (row && this.isExpired(row)) {
        // Lazy expiration — delete on read
        this.db.run("DELETE FROM kv WHERE namespace = ?1 AND key = ?2", [namespace, key]);
      }
      return null;
    }
    const tags = this.getTags(key, namespace);
    return this.toEntry(row, tags);
  }

  async set(key: string, value: string, options?: {
    namespace?: string;
    ttl?: number;
    tags?: string[];
  }): Promise<boolean> {
    this.ensureOpen();
    const ns = options?.namespace ?? "";
    const now = Date.now();
    const expiresAt = options?.ttl && options.ttl > 0 ? now + options.ttl : null;

    const txn = this.db.transaction(() => {
      this.db.run(
        `INSERT INTO kv (namespace, key, value, created_at, updated_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
        [ns, key, value, now, expiresAt]
      );

      // Replace tags
      this.db.run("DELETE FROM kv_tags WHERE namespace = ?1 AND key = ?2", [ns, key]);
      if (options?.tags?.length) {
        const insertTag = this.db.prepare(
          "INSERT INTO kv_tags (namespace, key, tag) VALUES (?1, ?2, ?3)"
        );
        for (const tag of options.tags) {
          insertTag.run(ns, key, tag);
        }
      }
    });
    txn();
    return true;
  }

  async delete(key: string, namespace = ""): Promise<boolean> {
    this.ensureOpen();
    const result = this.db.run(
      "DELETE FROM kv WHERE namespace = ?1 AND key = ?2",
      [namespace, key]
    );
    return result.changes > 0;
  }

  async has(key: string, namespace = ""): Promise<boolean> {
    this.ensureOpen();
    const row = this.db
      .query("SELECT expires_at FROM kv WHERE namespace = ?1 AND key = ?2")
      .get(namespace, key) as Record<string, unknown> | null;
    if (!row) return false;
    if (this.isExpired(row)) {
      this.db.run("DELETE FROM kv WHERE namespace = ?1 AND key = ?2", [namespace, key]);
      return false;
    }
    return true;
  }

  // ── Batch ────────────────────────────────────────────────

  async mget(keys: string[], namespace = ""): Promise<Record<string, StorageEntry | null>> {
    this.ensureOpen();
    const result: Record<string, StorageEntry | null> = {};
    for (const k of keys) {
      result[k] = await this.get(k, namespace);
    }
    return result;
  }

  async mset(entries: Array<{
    key: string;
    value: string;
    ttl?: number;
    tags?: string[];
  }>, namespace = ""): Promise<number> {
    this.ensureOpen();
    let count = 0;
    const txn = this.db.transaction(() => {
      for (const e of entries) {
        const now = Date.now();
        const expiresAt = e.ttl && e.ttl > 0 ? now + e.ttl : null;
        this.db.run(
          `INSERT INTO kv (namespace, key, value, created_at, updated_at, expires_at)
           VALUES (?1, ?2, ?3, ?4, ?4, ?5)
           ON CONFLICT(namespace, key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at,
             expires_at = excluded.expires_at`,
          [namespace, e.key, e.value, now, expiresAt]
        );
        // Replace tags
        this.db.run("DELETE FROM kv_tags WHERE namespace = ?1 AND key = ?2", [namespace, e.key]);
        if (e.tags?.length) {
          const insertTag = this.db.prepare(
            "INSERT INTO kv_tags (namespace, key, tag) VALUES (?1, ?2, ?3)"
          );
          for (const tag of e.tags) {
            insertTag.run(namespace, e.key, tag);
          }
        }
        count++;
      }
    });
    txn();
    return count;
  }

  async mdelete(keys: string[], namespace = ""): Promise<number> {
    this.ensureOpen();
    let deleted = 0;
    const txn = this.db.transaction(() => {
      for (const k of keys) {
        // Check existence first — db.run().changes may include FK cascades
        const exists = this.db.query(
          "SELECT 1 FROM kv WHERE namespace = ?1 AND key = ?2"
        ).get(namespace, k);
        if (exists) {
          this.db.run(
            "DELETE FROM kv WHERE namespace = ?1 AND key = ?2",
            [namespace, k]
          );
          deleted++;
        }
      }
    });
    txn();
    return deleted;
  }

  // ── Query ────────────────────────────────────────────────

  async query(options: StorageQueryOptions): Promise<StorageEntry[]> {
    this.ensureOpen();
    const conditions: string[] = ["(expires_at IS NULL OR expires_at > ?1)"];
    const params: SQLQueryBindings[] = [Date.now()];
    let paramIdx = 2;

    if (options.namespace !== undefined) {
      conditions.push(`namespace = ?${paramIdx}`);
      params.push(options.namespace);
      paramIdx++;
    }

    if (options.prefix) {
      conditions.push(`key LIKE ?${paramIdx}`);
      params.push(options.prefix + "%");
      paramIdx++;
    }

    if (options.tags?.length) {
      conditions.push(`EXISTS (
        SELECT 1 FROM kv_tags t
        WHERE t.namespace = kv.namespace AND t.key = kv.key
        AND t.tag IN (${options.tags.map(() => `?${paramIdx++}`).join(",")})
      )`);
      params.push(...options.tags);
    }

    const orderCol = options.orderBy === "key" ? "key"
      : options.orderBy === "updatedAt" ? "updated_at"
      : "created_at";
    const orderDir = options.order === "desc" ? "DESC" : "ASC";
    const limit = Math.min(options.limit ?? 100, 10_000);
    const offset = options.offset ?? 0;

    const sql = `SELECT * FROM kv WHERE ${conditions.join(" AND ")}
                 ORDER BY ${orderCol} ${orderDir}
                 LIMIT ?${paramIdx} OFFSET ?${paramIdx + 1}`;
    params.push(limit, offset);

    const rows = this.db.query(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const tags = this.getTags(row.key as string, row.namespace as string);
      return this.toEntry(row, tags);
    });
  }

  async count(namespace?: string): Promise<number> {
    this.ensureOpen();
    let sql = "SELECT COUNT(*) as cnt FROM kv WHERE (expires_at IS NULL OR expires_at > ?1)";
    const params: SQLQueryBindings[] = [Date.now()];
    if (namespace !== undefined) {
      sql += " AND namespace = ?2";
      params.push(namespace);
    }
    const row = this.db.query(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  async keys(pattern?: string, namespace?: string): Promise<string[]> {
    this.ensureOpen();
    const conditions: string[] = ["(expires_at IS NULL OR expires_at > ?1)"];
    const params: SQLQueryBindings[] = [Date.now()];
    let idx = 2;

    if (namespace !== undefined) {
      conditions.push(`namespace = ?${idx}`);
      params.push(namespace);
      idx++;
    }

    if (pattern && pattern !== "*") {
      // Convert glob to SQL LIKE: * → %, ? → _
      const like = pattern.replace(/%/g, "\\%").replace(/_/g, "\\_")
        .replace(/\*/g, "%").replace(/\?/g, "_");
      conditions.push(`key LIKE ?${idx} ESCAPE '\\'`);
      params.push(like);
    }

    const sql = `SELECT key FROM kv WHERE ${conditions.join(" AND ")} ORDER BY key`;
    const rows = this.db.query(sql).all(...params) as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }

  // ── Tag invalidation ─────────────────────────────────────

  async deleteByTags(tags: string[], namespace?: string): Promise<number> {
    this.ensureOpen();
    if (tags.length === 0) return 0;

    const placeholders = tags.map((_, i) => `?${i + 1}`).join(",");
    let innerWhere = `t.tag IN (${placeholders})`;
    const params: SQLQueryBindings[] = [...tags];

    if (namespace !== undefined) {
      innerWhere += ` AND t.namespace = ?${tags.length + 1}`;
      params.push(namespace);
    }

    // Count matching rows first — db.run().changes can include FK cascades
    const countSql = `SELECT COUNT(*) as cnt FROM kv WHERE (namespace, key) IN (
      SELECT t.namespace, t.key FROM kv_tags t WHERE ${innerWhere}
    )`;
    const row = this.db.query(countSql).get(...params) as { cnt: number };
    if (row.cnt === 0) return 0;

    const sql = `DELETE FROM kv WHERE (namespace, key) IN (
      SELECT t.namespace, t.key FROM kv_tags t WHERE ${innerWhere}
    )`;
    this.db.run(sql, params);
    return row.cnt;
  }

  // ── Management ───────────────────────────────────────────

  async clear(namespace?: string): Promise<void> {
    this.ensureOpen();
    if (namespace !== undefined) {
      this.db.run("DELETE FROM kv WHERE namespace = ?1", [namespace]);
    } else {
      this.db.run("DELETE FROM kv");
    }
  }

  async stats(): Promise<StorageStats> {
    this.ensureOpen();
    const total = this.db.query(
      "SELECT COUNT(*) as cnt FROM kv WHERE expires_at IS NULL OR expires_at > ?1"
    ).get(Date.now()) as { cnt: number };

    const namespaces = this.db.query(
      "SELECT COUNT(DISTINCT namespace) as cnt FROM kv"
    ).get() as { cnt: number };

    // page_count * page_size gives DB file size
    const pageCount = this.db.query("PRAGMA page_count").get() as { page_count: number };
    const pageSize = this.db.query("PRAGMA page_size").get() as { page_size: number };
    const dbSize = pageCount.page_count * pageSize.page_size;

    return {
      backend: "sqlite",
      totalEntries: total.cnt,
      totalNamespaces: namespaces.cnt,
      dbSizeBytes: dbSize,
    };
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
      log.info("SQLite adapter closed");
    }
  }

  // ── Expiry cleanup ───────────────────────────────────────

  async purgeExpired(): Promise<number> {
    this.ensureOpen();
    const result = this.db.run(
      "DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?1",
      [Date.now()]
    );
    if (result.changes > 0) {
      log.debug("Purged expired entries", { count: result.changes });
    }
    return result.changes;
  }
}
