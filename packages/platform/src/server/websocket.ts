// ── WebSocket Handler ──────────────────────────────────────
import type { ServerWebSocket } from "bun";
import type { WebSocketData, WSIncomingMessage } from "../types";
import type { CacheService } from "../services/cache-service";
import { validateKey, validateValue, validateTTL } from "../utils/validation";
import { logger } from "../utils/logger";

const log = logger.child("ws");

// ── WebSocket Rate Limiting ────────────────────────────────
const WS_RATE_WINDOW_MS = 1_000;  // 1-second window
const WS_RATE_MAX = 100;          // max messages per window per connection

function checkWSRate(ws: ServerWebSocket<WebSocketData>): boolean {
  const now = Date.now();
  const data = ws.data as WebSocketData & { _rlCount?: number; _rlWindow?: number };
  if (!data._rlWindow || now - data._rlWindow > WS_RATE_WINDOW_MS) {
    data._rlWindow = now;
    data._rlCount = 1;
    return true;
  }
  data._rlCount = (data._rlCount ?? 0) + 1;
  if (data._rlCount > WS_RATE_MAX) {
    ws.send(JSON.stringify({ type: "error", data: "Rate limit exceeded", timestamp: Date.now() }));
    return false;
  }
  return true;
}

export function createWebSocketHandlers(cacheService: CacheService) {
  return {
    open(ws: ServerWebSocket<WebSocketData>) {
      ws.data.connectedAt = Date.now();
      ws.data.id = crypto.randomUUID();
      ws.data.subscribedChannels = new Set(["cache"]);

      // Subscribe to the built-in Bun pub/sub topic
      ws.subscribe("cache-events");
      ws.subscribe("stats");

      ws.send(
        JSON.stringify({
          type: "connected",
          data: { id: ws.data.id },
          timestamp: Date.now(),
        })
      );

      log.debug("WebSocket connected", { id: ws.data.id });
    },

    message(ws: ServerWebSocket<WebSocketData>, raw: string | Buffer) {
      if (!checkWSRate(ws)) return;

      let msg: WSIncomingMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", data: "Invalid JSON" }));
        return;
      }

      switch (msg.type) {
        case "ping":
          ws.send(
            JSON.stringify({ type: "pong", timestamp: Date.now() })
          );
          break;

        case "subscribe":
          if (msg.channel) {
            ws.subscribe(msg.channel);
            ws.data.subscribedChannels.add(msg.channel);
            ws.send(
              JSON.stringify({
                type: "subscribed",
                data: { channel: msg.channel },
                timestamp: Date.now(),
              })
            );
          }
          break;

        case "unsubscribe":
          if (msg.channel) {
            ws.unsubscribe(msg.channel);
            ws.data.subscribedChannels.delete(msg.channel);
          }
          break;

        case "get":
          if (msg.key) {
            const kv = validateKey(msg.key);
            if (!kv.valid) {
              ws.send(JSON.stringify({ type: "error", data: kv.error, timestamp: Date.now() }));
              break;
            }
            const value = cacheService.get(msg.key, msg.ns);
            ws.send(
              JSON.stringify({
                type: "result",
                data: { key: msg.key, value },
                timestamp: Date.now(),
              })
            );
          }
          break;

        case "set":
          if (msg.key && msg.value !== undefined) {
            const sk = validateKey(msg.key);
            if (!sk.valid) {
              ws.send(JSON.stringify({ type: "error", data: sk.error, timestamp: Date.now() }));
              break;
            }
            const sv = validateValue(msg.value);
            if (!sv.valid) {
              ws.send(JSON.stringify({ type: "error", data: sv.error, timestamp: Date.now() }));
              break;
            }
            const st = validateTTL(msg.ttl);
            if (!st.valid) {
              ws.send(JSON.stringify({ type: "error", data: st.error, timestamp: Date.now() }));
              break;
            }
            const ok = cacheService.set(msg.key, msg.value, msg.ttl, msg.ns);
            ws.send(
              JSON.stringify({
                type: "result",
                data: { key: msg.key, ok },
                timestamp: Date.now(),
              })
            );
          }
          break;

        case "del":
          if (msg.key) {
            const dk = validateKey(msg.key);
            if (!dk.valid) {
              ws.send(JSON.stringify({ type: "error", data: dk.error, timestamp: Date.now() }));
              break;
            }
            const ok = cacheService.delete(msg.key, msg.ns);
            ws.send(
              JSON.stringify({
                type: "result",
                data: { key: msg.key, deleted: ok },
                timestamp: Date.now(),
              })
            );
          }
          break;

        case "mget":
          if (Array.isArray(msg.keys)) {
            const result = cacheService.mget(msg.keys, msg.ns);
            ws.send(
              JSON.stringify({
                type: "result",
                data: { result },
                timestamp: Date.now(),
              })
            );
          }
          break;

        case "mset":
          if (Array.isArray(msg.entries)) {
            for (const e of msg.entries) {
              const ek = validateKey(e.key);
              if (!ek.valid) {
                ws.send(JSON.stringify({ type: "error", data: `mset key error: ${ek.error}`, timestamp: Date.now() }));
                return;
              }
              const ev = validateValue(e.value);
              if (!ev.valid) {
                ws.send(JSON.stringify({ type: "error", data: `mset value error for "${e.key}": ${ev.error}`, timestamp: Date.now() }));
                return;
              }
            }
            const count = cacheService.mset(msg.entries, msg.ns);
            ws.send(
              JSON.stringify({
                type: "result",
                data: { stored: count },
                timestamp: Date.now(),
              })
            );
          }
          break;

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              data: `Unknown message type: ${(msg as { type: string }).type}`,
            })
          );
      }
    },

    close(ws: ServerWebSocket<WebSocketData>) {
      log.debug("WebSocket disconnected", { id: ws.data.id });
    },
  };
}
