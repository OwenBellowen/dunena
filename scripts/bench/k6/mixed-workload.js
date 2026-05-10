// ── Dunena k6 Benchmark: Mixed Workload ────────────────────
// Simulates a realistic cache workload: 80% reads, 20% writes.
//
// Usage:
//   k6 run scripts/bench/k6/mixed-workload.js
//   k6 run scripts/bench/k6/mixed-workload.js --vus 100 --duration 60s

import http from "k6/http";
import { check, sleep } from "k6";
import { config } from "./config.js";

export const options = {
  stages: [
    { duration: "10s", target: 20 },  // ramp up
    { duration: "30s", target: 50 },  // sustain
    { duration: "10s", target: 100 }, // peak
    { duration: "10s", target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<20", "p(99)<50"],
    http_req_failed: ["rate<0.01"],
  },
};

const headers = { "Content-Type": "application/json", ...config.authHeaders };
const KEY_SPACE = 1000; // Number of unique keys

export default function () {
  const key = `mixed-${Math.floor(Math.random() * KEY_SPACE)}`;
  const isWrite = Math.random() < 0.2; // 20% writes

  if (isWrite) {
    const payload = JSON.stringify({
      value: `val-${Date.now()}-${"z".repeat(48)}`,
      ttl: 30000,
    });
    const res = http.post(`${config.baseUrl}/cache/${key}`, payload, { headers });
    check(res, {
      "WRITE status ok": (r) => r.status === 201 || r.status === 200,
    });
  } else {
    const res = http.get(`${config.baseUrl}/cache/${key}`, { headers });
    check(res, {
      "READ status ok": (r) => r.status === 200 || r.status === 404,
    });
  }
}
