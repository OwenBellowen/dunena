// ── Dunena k6 Shared Config ────────────────────────────────

export const config = {
  baseUrl: __ENV.DUNENA_URL || "http://localhost:3000",
  authHeaders: __ENV.DUNENA_AUTH_TOKEN
    ? { Authorization: `Bearer ${__ENV.DUNENA_AUTH_TOKEN}` }
    : {},
};
