// ── Distributed Lock Service ────────────────────────────────
// Simple distributed locking mechanism for coordination.
// Locks are stored in the cache with TTL for automatic release.

import { CacheService } from "./cache-service";
import { PubSubService } from "./pubsub-service";
import type { Lock, LockConfig } from "../types";
import { logger } from "../utils/logger";

const log = logger.child("locks");

const LOCK_PREFIX = "__lock__";

export class LockService {
  private cacheService: CacheService;
  private pubsub: PubSubService;
  private config: LockConfig;

  constructor(cacheService: CacheService, pubsub: PubSubService, config?: Partial<LockConfig>) {
    this.cacheService = cacheService;
    this.pubsub = pubsub;
    this.config = {
      defaultTTL: config?.defaultTTL ?? 30_000,   // 30 seconds default
      maxTTL: config?.maxTTL ?? 300_000,          // 5 minutes max
      retryDelay: config?.retryDelay ?? 100,      // 100ms between retries
      maxRetries: config?.maxRetries ?? 50,       // 50 retries = 5 seconds max wait
    };
    log.info("Lock service initialized", this.config);
  }

  private lockKey(key: string): string {
    return `${LOCK_PREFIX}${key}`;
  }

  /**
   * Attempt to acquire a lock
   * Returns lock info on success, null if lock is already held
   */
  acquire(key: string, owner: string, ttl?: number): Lock | null {
    const effectiveTTL = Math.min(ttl ?? this.config.defaultTTL, this.config.maxTTL);
    const lockKey = this.lockKey(key);
    
    // Check if lock already exists
    const existing = this.cacheService.get(lockKey);
    if (existing !== null) {
      // Lock is held by someone
      return null;
    }

    // Try to acquire the lock
    const now = Date.now();
    const lock: Lock = {
      key,
      owner,
      acquiredAt: now,
      expiresAt: now + effectiveTTL,
      ttl: effectiveTTL,
    };

    const ok = this.cacheService.set(lockKey, JSON.stringify(lock), effectiveTTL);
    if (!ok) return null;

    this.pubsub.publish("locks", "acquired", { key, owner });
    log.debug("Lock acquired", { key, owner, ttl: effectiveTTL });
    return lock;
  }

  /**
   * Attempt to acquire a lock with retries
   */
  async acquireWithRetry(key: string, owner: string, ttl?: number): Promise<Lock | null> {
    for (let i = 0; i < this.config.maxRetries; i++) {
      const lock = this.acquire(key, owner, ttl);
      if (lock) return lock;
      await this.sleep(this.config.retryDelay);
    }
    return null;
  }

  /**
   * Release a lock (only if owner matches)
   */
  release(key: string, owner: string): boolean {
    const lockKey = this.lockKey(key);
    const existing = this.cacheService.get(lockKey);
    if (existing === null) return false;

    try {
      const lock = JSON.parse(existing) as Lock;
      if (lock.owner !== owner) {
        log.warn("Lock release denied: owner mismatch", { key, expectedOwner: lock.owner, actualOwner: owner });
        return false;
      }

      this.cacheService.delete(lockKey);
      this.pubsub.publish("locks", "released", { key, owner });
      log.debug("Lock released", { key, owner });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Force release a lock (admin operation, ignores owner)
   */
  forceRelease(key: string): boolean {
    const lockKey = this.lockKey(key);
    const deleted = this.cacheService.delete(lockKey);
    if (deleted) {
      this.pubsub.publish("locks", "force_released", { key });
      log.info("Lock force released", { key });
    }
    return deleted;
  }

  /**
   * Extend a lock's TTL (only if owner matches)
   */
  extend(key: string, owner: string, additionalTTL: number): Lock | null {
    const lockKey = this.lockKey(key);
    const existing = this.cacheService.get(lockKey);
    if (existing === null) return null;

    try {
      const lock = JSON.parse(existing) as Lock;
      if (lock.owner !== owner) {
        log.warn("Lock extend denied: owner mismatch", { key, expectedOwner: lock.owner, actualOwner: owner });
        return null;
      }

      const newTTL = Math.min(additionalTTL, this.config.maxTTL);
      const now = Date.now();
      const newLock: Lock = {
        ...lock,
        expiresAt: now + newTTL,
        ttl: newTTL,
      };

      // Use touch to update TTL
      const ok = this.cacheService.touch(lockKey, newTTL);
      if (!ok) return null;

      // Update lock data
      this.cacheService.set(lockKey, JSON.stringify(newLock), newTTL);

      this.pubsub.publish("locks", "extended", { key, owner, newTTL });
      log.debug("Lock extended", { key, owner, newTTL });
      return newLock;
    } catch {
      return null;
    }
  }

  /**
   * Check if a lock is held
   */
  isLocked(key: string): boolean {
    const lockKey = this.lockKey(key);
    return this.cacheService.has(lockKey);
  }

  /**
   * Get lock info
   */
  getLock(key: string): Lock | null {
    const lockKey = this.lockKey(key);
    const data = this.cacheService.get(lockKey);
    if (data === null) return null;

    try {
      return JSON.parse(data) as Lock;
    } catch {
      return null;
    }
  }

  /**
   * List all active locks
   */
  listLocks(): Lock[] {
    const locks: Lock[] = [];
    const result = this.cacheService.keys(`${LOCK_PREFIX}*`);
    
    for (const key of result.keys) {
      const data = this.cacheService.get(key);
      if (data) {
        try {
          locks.push(JSON.parse(data) as Lock);
        } catch {
          // Skip invalid lock data
        }
      }
    }
    
    return locks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
