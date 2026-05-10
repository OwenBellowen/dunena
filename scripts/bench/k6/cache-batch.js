// ── Dunena k6 Benchmark: Batch Operations ──────────────────
// Measures throughput for MGET and MSET batch operations.
//
// Usage:
//   k6 run scripts/bench/k6/cache-batch.js

import http from "k6/http";
import { check } from "k6";
import { config } from "./config.js";

export const options = {
  scenarios: {
    mset_ops: {
      executor: "constant-vus",
      vus: 10,
      duration: "15s",
      exec: "msetOperation",
      tags: { op: "mset" },
    },
    mget_ops: {
      executor: "constant-vus",
      vus: 10,
      duration: "15s",
      exec: "mgetOperation",
      startTime: "15s",
      tags: { op: "mget" },
    },
  },
  thresholds: {
    "http_req_duration{op:mset}": ["p(95)<50", "p(99)<100"],
    "http_req_duration{op:mget}": ["p(95)<30", "p(99)<60"],
    http_req_failed: ["rate<0.01"],
  },
};

const headers = { "Content-Type": "application/json", ...config.authHeaders };

export function msetOperation() {
  const batchSize = 20;
  const entries = [];
  for (let i = 0; i < batchSize; i++) {
    entries.push({
      key: `batch-${__VU}-${__ITER}-${i}`,
      value: `value-${i}-${"y".repeat(32)}`,
    });
  }

  const payload = JSON.stringify({ action: "mset", entries });
  const res = http.post(`${config.baseUrl}/cache`, payload, { headers });
  check(res, {
    "MSET status is 200": (r) => r.status === 200,
    "MSET stored count matches": (r) => JSON.parse(r.body).stored === batchSize,
  });
}

export function mgetOperation() {
  const batchSize = 20;
  const keys = [];
  for (let i = 0; i < batchSize; i++) {
    keys.push(`batch-${__VU}-${__ITER % 50}-${i}`);
  }

  const payload = JSON.stringify({ action: "mget", keys });
  const res = http.post(`${config.baseUrl}/cache`, payload, { headers });
  check(res, {
    "MGET status is 200": (r) => r.status === 200,
    "MGET has result": (r) => JSON.parse(r.body).result !== undefined,
  });
}
