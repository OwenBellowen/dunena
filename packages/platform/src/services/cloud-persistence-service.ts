// ── Cloud Persistence Service ──────────────────────────────
// Extends snapshot persistence with automatic cloud backup
// syncs to S3-compatible storage (AWS S3, R2, MinIO, etc.).

import { logger } from "../utils/logger";
import { readFileSync, writeFileSync, existsSync } from "fs";

const log = logger.child("cloud-persist");

// ── Cloud Storage Backend Interface ────────────────────────

export interface CloudStorageBackend {
  upload(key: string, data: Buffer): Promise<void>;
  download(key: string): Promise<Buffer | null>;
  list(prefix?: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

// ── Cloud Persistence Config ───────────────────────────────

export interface CloudPersistenceConfig {
  enabled: boolean;
  provider: "s3";
  bucket: string;
  region: string;
  prefix: string;
  endpoint?: string;  // Custom endpoint for R2/MinIO
  accessKeyId?: string;
  secretAccessKey?: string;
}

// ── S3 Backend ─────────────────────────────────────────────
// Uses @aws-sdk/client-s3 (optional peer dependency).

export class S3Backend implements CloudStorageBackend {
  private client: any = null;
  private config: CloudPersistenceConfig;

  constructor(config: CloudPersistenceConfig) {
    this.config = config;
  }

  private async ensureClient(): Promise<void> {
    if (this.client) return;
    try {
      const { S3Client } = await import("@aws-sdk/client-s3");
      const clientConfig: any = { region: this.config.region };
      if (this.config.endpoint) {
        clientConfig.endpoint = this.config.endpoint;
        clientConfig.forcePathStyle = true;
      }
      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        };
      }
      this.client = new S3Client(clientConfig);
    } catch (err) {
      if ((err as any)?.code === "ERR_MODULE_NOT_FOUND" || (err as any)?.code === "MODULE_NOT_FOUND") {
        throw new Error(
          'Cloud persistence requires "@aws-sdk/client-s3". Install with: bun add @aws-sdk/client-s3'
        );
      }
      throw err;
    }
  }

  async upload(key: string, data: Buffer): Promise<void> {
    await this.ensureClient();
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const fullKey = this.config.prefix + key;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
        Body: data,
        ContentType: "application/json",
      })
    );
    log.info("Uploaded snapshot to cloud", { key: fullKey, bytes: data.length });
  }

  async download(key: string): Promise<Buffer | null> {
    await this.ensureClient();
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const fullKey = this.config.prefix + key;
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: fullKey,
        })
      );
      const body = await response.Body?.transformToByteArray();
      return body ? Buffer.from(body) : null;
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    await this.ensureClient();
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const fullPrefix = this.config.prefix + (prefix ?? "");
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: fullPrefix,
      })
    );
    return (response.Contents ?? []).map((obj: any) => obj.Key as string);
  }

  async delete(key: string): Promise<void> {
    await this.ensureClient();
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const fullKey = this.config.prefix + key;
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      })
    );
    log.info("Deleted cloud snapshot", { key: fullKey });
  }
}

// ── Cloud Persistence Service ──────────────────────────────

export class CloudPersistenceService {
  private config: CloudPersistenceConfig;
  private backend: CloudStorageBackend;

  constructor(config: CloudPersistenceConfig) {
    this.config = config;
    this.backend = this.createBackend(config);
    log.info("Cloud persistence initialized", {
      provider: config.provider,
      bucket: config.bucket,
      prefix: config.prefix,
    });
  }

  private createBackend(config: CloudPersistenceConfig): CloudStorageBackend {
    switch (config.provider) {
      case "s3":
        return new S3Backend(config);
      default:
        throw new Error(`Unknown cloud provider: ${config.provider}`);
    }
  }

  /**
   * Upload a local snapshot file to cloud storage.
   */
  async uploadSnapshot(localPath: string): Promise<void> {
    if (!this.config.enabled) return;
    if (!existsSync(localPath)) {
      log.warn("Snapshot file not found, skipping cloud upload", { path: localPath });
      return;
    }
    try {
      const data = readFileSync(localPath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const key = `snapshot-${timestamp}.json`;
      await this.backend.upload(key, data);
    } catch (err) {
      log.error("Cloud snapshot upload failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Download the latest snapshot from cloud and save locally.
   */
  async downloadLatest(localPath: string): Promise<boolean> {
    if (!this.config.enabled) return false;
    try {
      const keys = await this.backend.list("snapshot-");
      if (keys.length === 0) {
        log.info("No cloud snapshots found");
        return false;
      }
      // Get the most recent snapshot (lexicographic sort by timestamp)
      keys.sort();
      const latestKey = keys[keys.length - 1];
      // Strip prefix to get just the filename part
      const shortKey = latestKey.startsWith(this.config.prefix)
        ? latestKey.slice(this.config.prefix.length)
        : latestKey;
      const data = await this.backend.download(shortKey);
      if (!data) return false;
      writeFileSync(localPath, data);
      log.info("Downloaded cloud snapshot", { key: latestKey, bytes: data.length });
      return true;
    } catch (err) {
      log.error("Cloud snapshot download failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * List available cloud snapshots.
   */
  async listSnapshots(): Promise<string[]> {
    if (!this.config.enabled) return [];
    return this.backend.list("snapshot-");
  }
}
