// ── Cache Replication Service ───────────────────────────────
// Write-through replication to secondary cache instances.
// Supports async and sync replication modes.

import { PubSubService } from "./pubsub-service";
import type { ReplicaConfig, ReplicationConfig, ReplicationStats } from "../types";
import { logger } from "../utils/logger";

const log = logger.child("replication");

export class ReplicationService {
  private config: ReplicationConfig;
  private pubsub: PubSubService;
  private stats: Map<string, ReplicationStats> = new Map();
  private pendingQueue: Map<string, Array<ReplicationOp>> = new Map();

  constructor(pubsub: PubSubService, config?: Partial<ReplicationConfig>) {
    this.pubsub = pubsub;
    this.config = {
      enabled: config?.enabled ?? false,
      replicas: config?.replicas ?? [],
      retryAttempts: config?.retryAttempts ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
    };

    // Initialize stats for each replica
    for (const replica of this.config.replicas) {
      this.stats.set(replica.id, {
        replicaId: replica.id,
        lastSyncAt: 0,
        syncCount: 0,
        errorCount: 0,
      });
      this.pendingQueue.set(replica.id, []);
    }

    log.info("Replication service initialized", { 
      enabled: this.config.enabled, 
      replicaCount: this.config.replicas.length 
    });
  }

  /**
   * Register a new replica
   */
  addReplica(replica: ReplicaConfig): void {
    // Check if replica already exists
    const existing = this.config.replicas.find(r => r.id === replica.id);
    if (existing) {
      // Update existing replica
      Object.assign(existing, replica);
      log.info("Replica updated", { id: replica.id });
    } else {
      this.config.replicas.push(replica);
      this.stats.set(replica.id, {
        replicaId: replica.id,
        lastSyncAt: 0,
        syncCount: 0,
        errorCount: 0,
      });
      this.pendingQueue.set(replica.id, []);
      log.info("Replica added", { id: replica.id, url: replica.url });
    }
  }

  /**
   * Remove a replica
   */
  removeReplica(replicaId: string): boolean {
    const index = this.config.replicas.findIndex(r => r.id === replicaId);
    if (index === -1) return false;

    this.config.replicas.splice(index, 1);
    this.stats.delete(replicaId);
    this.pendingQueue.delete(replicaId);
    log.info("Replica removed", { id: replicaId });
    return true;
  }

  /**
   * Replicate a SET operation to all replicas
   */
  async replicateSet(key: string, value: string, ttl?: number, ns?: string): Promise<void> {
    if (!this.config.enabled || this.config.replicas.length === 0) return;

    const op: ReplicationOp = { type: "set", key, value, ttl, ns };
    await this.replicateOp(op);
  }

  /**
   * Replicate a DELETE operation to all replicas
   */
  async replicateDelete(key: string, ns?: string): Promise<void> {
    if (!this.config.enabled || this.config.replicas.length === 0) return;

    const op: ReplicationOp = { type: "delete", key, ns };
    await this.replicateOp(op);
  }

  /**
   * Replicate a CLEAR operation to all replicas
   */
  async replicateClear(): Promise<void> {
    if (!this.config.enabled || this.config.replicas.length === 0) return;

    const op: ReplicationOp = { type: "clear" };
    await this.replicateOp(op);
  }

  private async replicateOp(op: ReplicationOp): Promise<void> {
    const enabledReplicas = this.config.replicas.filter(r => r.enabled);

    const promises = enabledReplicas.map(replica => 
      this.sendToReplica(replica, op)
    );

    // For async mode, don't wait
    const asyncReplicas = enabledReplicas.filter(r => r.syncMode === "async");
    const syncReplicas = enabledReplicas.filter(r => r.syncMode === "sync");

    // Wait for sync replicas
    if (syncReplicas.length > 0) {
      const syncPromises = syncReplicas.map(replica => 
        this.sendToReplica(replica, op)
      );
      await Promise.allSettled(syncPromises);
    }

    // Fire and forget for async replicas
    if (asyncReplicas.length > 0) {
      Promise.allSettled(
        asyncReplicas.map(replica => this.sendToReplica(replica, op))
      ).catch(() => {}); // Ignore errors for async
    }
  }

  private async sendToReplica(replica: ReplicaConfig, op: ReplicationOp): Promise<boolean> {
    const stats = this.stats.get(replica.id)!;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const response = await this.makeRequest(replica, op);
        if (response.ok) {
          stats.syncCount++;
          stats.lastSyncAt = Date.now();
          stats.lastError = undefined;
          return true;
        }
        stats.lastError = `HTTP ${response.status}`;
      } catch (err) {
        stats.lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt < this.config.retryAttempts - 1) {
        await this.sleep(this.config.retryDelayMs);
      }
    }

    stats.errorCount++;
    log.warn("Replication failed", { 
      replicaId: replica.id, 
      op: op.type, 
      error: stats.lastError 
    });
    return false;
  }

  private async makeRequest(replica: ReplicaConfig, op: ReplicationOp): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (replica.authToken) {
      headers["Authorization"] = `Bearer ${replica.authToken}`;
    }

    let url = replica.url;
    let method: string;
    let body: string | undefined;

    switch (op.type) {
      case "set":
        url = `${replica.url}/cache/${encodeURIComponent(op.key!)}`;
        if (op.ns) url += `?ns=${encodeURIComponent(op.ns)}`;
        method = "POST";
        body = JSON.stringify({ value: op.value, ttl: op.ttl });
        break;
      case "delete":
        url = `${replica.url}/cache/${encodeURIComponent(op.key!)}`;
        if (op.ns) url += `?ns=${encodeURIComponent(op.ns)}`;
        method = "DELETE";
        break;
      case "clear":
        url = `${replica.url}/flush`;
        method = "POST";
        break;
      default:
        throw new Error(`Unknown operation type: ${(op as ReplicationOp).type}`);
    }

    return fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
  }

  /**
   * Get replication status for all replicas
   */
  getStats(): ReplicationStats[] {
    return Array.from(this.stats.values());
  }

  /**
   * Get config info
   */
  getConfig(): ReplicationConfig {
    return { ...this.config };
  }

  /**
   * List all replicas
   */
  listReplicas(): ReplicaConfig[] {
    return [...this.config.replicas];
  }

  /**
   * Enable/disable replication
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.pubsub.publish("replication", enabled ? "enabled" : "disabled", {});
    log.info(`Replication ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Enable/disable a specific replica
   */
  setReplicaEnabled(replicaId: string, enabled: boolean): boolean {
    const replica = this.config.replicas.find(r => r.id === replicaId);
    if (!replica) return false;
    replica.enabled = enabled;
    log.info(`Replica ${replicaId} ${enabled ? "enabled" : "disabled"}`);
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface ReplicationOp {
  type: "set" | "delete" | "clear";
  key?: string;
  value?: string;
  ttl?: number;
  ns?: string;
}
