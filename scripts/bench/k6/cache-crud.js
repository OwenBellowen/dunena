// ── Dunena k6 Benchmark: Cache CRUD ────────────────────────
// Measures throughput and latency for basic cache operations.
//
// Usage:
//   k6 run scripts/bench/k6/cache-crud.js
//   k6 run scripts/bench/k6/cache-crud.js --vus 50 --duration 30s

import http from "k6/http";
import { check, sleep } from "k6";
import { config } from "./config.js";

export const options = {
  scenarios: {
    set_ops: {
      executor: "constant-vus",
      vus: 20,
      duration: "15s",
      exec: "setOperation",
      tags: { op: "set" },
    },
    get_ops: {
      executor: "constant-vus",
      vus: 20,
      duration: "15s",
      exec: "getOperation",
      startTime: "15s", // Start after SET phase
      tags: { op: "get" },
    },
    delete_ops: {
      executor: "constant-vus",
      vus: 10,
      duration: "10s",
      exec: "deleteOperation",
      startTime: "30s", // Start after GET phase
      tags: { op: "delete" },
    },
  },
  thresholds: {
    "http_req_duration{op:get}": ["p(95)<10", "p(99)<25"],
    "http_req_duration{op:set}": ["p(95)<15", "p(99)<30"],
    "http_req_duration{op:delete}": ["p(95)<10", "p(99)<25"],
    http_req_failed: ["rate<0.01"], // <1% error rate
  },
};

const headers = { "Content-Type": "application/json", ...config.authHeaders };

export function setOperation() {
  const key = `bench-${__VU}-${__ITER}`;
  const payload = JSON.stringify({
    value: `value-${key}-${"x".repeat(64)}`,
    ttl: 60000,
  });

  const res = http.post(`${config.baseUrl}/cache/${key}`, payload, { headers });
  check(res, {
    "SET status is 201": (r) => r.status === 201,
    "SET response has ok": (r) => JSON.parse(r.body).ok === true,
  });
}

export function getOperation() {
  const key = `bench-${__VU}-${__ITER % 100}`;
  const res = http.get(`${config.baseUrl}/cache/${key}`, { headers });
  check(res, {
    "GET status is 200 or 404": (r) => r.status === 200 || r.status === 404,
  });
}

export function deleteOperation() {
  const key = `bench-${__VU}-${__ITER}`;
  const res = http.del(`${config.baseUrl}/cache/${key}`, null, { headers });
  check(res, {
    "DEL status is 200": (r) => r.status === 200,
  });
}
