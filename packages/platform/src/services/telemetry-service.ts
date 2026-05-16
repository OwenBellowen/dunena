// ── OpenTelemetry Telemetry Service ────────────────────────
// Provides opt-in distributed tracing and metrics export via
// the OpenTelemetry SDK.  All OTEL dependencies are loaded
// dynamically so the build never breaks without them.

import { logger } from "../utils/logger";

const log = logger.child("telemetry");

// ── Config ─────────────────────────────────────────────────

export interface TelemetryConfig {
  enabled: boolean;
  endpoint: string;       // OTLP HTTP endpoint (e.g. http://localhost:4318)
  serviceName: string;
  serviceVersion: string;
  environment?: string;
}

// ── Tracer Singleton ───────────────────────────────────────

let tracerInstance: any = null;
let meterInstance: any = null;
let sdkInstance: any = null;

/**
 * Initialise the OpenTelemetry SDK.
 * Safe to call even when OTEL deps aren't installed — it will
 * log a warning and return a no-op tracer/meter.
 */
export async function initTelemetry(config: TelemetryConfig): Promise<void> {
  if (!config.enabled) {
    log.info("Telemetry disabled");
    return;
  }

  try {
    // Dynamic imports — these are optional peer dependencies
    const otelApi = await import("@opentelemetry/api");
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
    const { Resource } = await import("@opentelemetry/resources");
    const {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
    } = await import("@opentelemetry/semantic-conventions");

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      ...(config.environment ? { "deployment.environment": config.environment } : {}),
    });

    const traceExporter = new OTLPTraceExporter({
      url: `${config.endpoint}/v1/traces`,
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${config.endpoint}/v1/metrics`,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 15_000,
    });

    const sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader: metricReader as any,
    });

    sdk.start();
    sdkInstance = sdk;

    tracerInstance = otelApi.trace.getTracer(config.serviceName, config.serviceVersion);
    meterInstance = otelApi.metrics.getMeter(config.serviceName, config.serviceVersion);

    log.info("OpenTelemetry initialised", {
      endpoint: config.endpoint,
      serviceName: config.serviceName,
    });
  } catch (err: any) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "MODULE_NOT_FOUND") {
      log.warn(
        "OpenTelemetry dependencies not installed. Install with: " +
        "bun add @opentelemetry/api @opentelemetry/sdk-node " +
        "@opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http " +
        "@opentelemetry/sdk-metrics @opentelemetry/resources @opentelemetry/semantic-conventions"
      );
    } else {
      log.error("Failed to initialise OpenTelemetry", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Shutdown the OTEL SDK gracefully (flushes pending spans/metrics).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdkInstance) {
    try {
      await sdkInstance.shutdown();
      log.info("OpenTelemetry shut down");
    } catch (err) {
      log.error("Error shutting down OpenTelemetry", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Span Helpers ───────────────────────────────────────────
// These helpers are safe to call even without OTEL installed.
// When telemetry is disabled, they produce no-op spans.

/**
 * Start a span around a synchronous or async operation.
 * Returns the result of the callback.
 */
export async function withSpan<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => T | Promise<T>,
): Promise<T> {
  if (!tracerInstance) {
    return fn();
  }

  const otelApi = await import("@opentelemetry/api");
  return tracerInstance.startActiveSpan(
    spanName,
    { attributes },
    async (span: any) => {
      try {
        const result = await fn();
        span.setStatus({ code: otelApi.SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({
          code: otelApi.SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

// ── Metric Helpers ─────────────────────────────────────────

export interface CacheMetrics {
  hitCounter: any;
  missCounter: any;
  setCounter: any;
  deleteCounter: any;
  latencyHistogram: any;
}

let cacheMetrics: CacheMetrics | null = null;

/**
 * Get or create cache operation metrics.
 */
export function getCacheMetrics(): CacheMetrics | null {
  if (!meterInstance) return null;
  if (cacheMetrics) return cacheMetrics;

  cacheMetrics = {
    hitCounter: meterInstance.createCounter("dunena.cache.hits", {
      description: "Number of cache hits",
    }),
    missCounter: meterInstance.createCounter("dunena.cache.misses", {
      description: "Number of cache misses",
    }),
    setCounter: meterInstance.createCounter("dunena.cache.sets", {
      description: "Number of cache set operations",
    }),
    deleteCounter: meterInstance.createCounter("dunena.cache.deletes", {
      description: "Number of cache delete operations",
    }),
    latencyHistogram: meterInstance.createHistogram("dunena.cache.latency_ms", {
      description: "Cache operation latency in milliseconds",
      unit: "ms",
    }),
  };
  return cacheMetrics;
}

/**
 * Record a cache operation metric.
 */
export function recordCacheOp(
  op: "hit" | "miss" | "set" | "delete",
  latencyMs?: number,
  attributes?: Record<string, string>,
): void {
  const m = getCacheMetrics();
  if (!m) return;

  const attrs = attributes ?? {};

  switch (op) {
    case "hit":
      m.hitCounter.add(1, attrs);
      break;
    case "miss":
      m.missCounter.add(1, attrs);
      break;
    case "set":
      m.setCounter.add(1, attrs);
      break;
    case "delete":
      m.deleteCounter.add(1, attrs);
      break;
  }

  if (latencyMs !== undefined) {
    m.latencyHistogram.record(latencyMs, { operation: op, ...attrs });
  }
}
