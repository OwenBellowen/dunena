// ── Analytics Service ───────────────────────────────────────
// Records request latencies and periodically snapshots metrics.
// Uses the Zig stats engine for percentile calculations.

import { NativeStats } from "../bridge/cache-bridge";
import type { CacheStats, AnalyticsSnapshot } from "../types";

const MAX_LATENCIES = 10_000;

export class AnalyticsService {
  private latencies: number[] = [];
  private requestCount = 0;
  private windowStart = Date.now();
  private snapshots: AnalyticsSnapshot[] = [];
  private maxSnapshots: number;

  constructor(maxSnapshots = 1440) {
    this.maxSnapshots = maxSnapshots;
  }

  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > MAX_LATENCIES) {
      this.latencies = this.latencies.slice(-MAX_LATENCIES);
    }
  }

  recordRequest(): void {
    this.requestCount++;
  }

  takeSnapshot(stats: CacheStats): AnalyticsSnapshot {
    const now = Date.now();
    const elapsed = (now - this.windowStart) / 1000;

    const snap: AnalyticsSnapshot = {
      timestamp: now,
      stats,
      requestsPerSecond: elapsed > 0 ? this.requestCount / elapsed : 0,
      avgLatencyMs:
        this.latencies.length > 0
          ? NativeStats.mean(this.latencies)
          : 0,
      p99LatencyMs:
        this.latencies.length > 0
          ? NativeStats.percentile(this.latencies, 99)
          : 0,
    };

    this.snapshots.push(snap);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Reset window
    this.requestCount = 0;
    this.latencies = [];
    this.windowStart = now;

    return snap;
  }

  getLatestSnapshot(): AnalyticsSnapshot | null {
    return this.snapshots.at(-1) ?? null;
  }

  getHistory(count = 60): AnalyticsSnapshot[] {
    return this.snapshots.slice(-count);
  }

  getLatencyStats(): {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    stdDev: number;
    count: number;
  } {
    if (this.latencies.length === 0) {
      return { mean: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, stdDev: 0, count: 0 };
    }
    return {
      mean: NativeStats.mean(this.latencies),
      p50: NativeStats.percentile(this.latencies, 50),
      p95: NativeStats.percentile(this.latencies, 95),
      p99: NativeStats.percentile(this.latencies, 99),
      min: NativeStats.min(this.latencies),
      max: NativeStats.max(this.latencies),
      stdDev: NativeStats.stdDev(this.latencies),
      count: this.latencies.length,
    };
  }
}
