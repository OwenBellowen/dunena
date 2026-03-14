// ── Database Module ─────────────────────────────────────────
export type { StorageAdapter, StorageEntry, StorageQueryOptions, StorageStats } from "./adapter";
export { SQLiteAdapter, type SQLiteAdapterOptions } from "./sqlite-adapter";
export { QueryCacheService, type QueryCacheResult, type QueryCacheStats } from "./query-cache";
export {
  DatabaseProxy,
  HttpDatabaseConnector,
  SqlDatabaseConnector,
  type DatabaseType,
  type DatabaseConnectorConfig,
  type ProxyQueryRequest,
  type ProxyQueryResult,
} from "./proxy";
