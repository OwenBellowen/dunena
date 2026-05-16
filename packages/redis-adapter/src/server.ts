// ── Redis Translation Server ───────────────────────────────
// Uses Bun.listen to bind a TCP port and translate RESP
// commands to Dunena CacheService methods.

import { RESP } from "./parser";
import type { CacheService } from "@dunena/platform";

interface RedisServerConfig {
  port: number;
  host: string;
}

export class RedisAdapterServer {
  private cache: CacheService;
  private config: RedisServerConfig;
  private server: any = null;

  constructor(cache: CacheService, config: RedisServerConfig) {
    this.cache = cache;
    this.config = config;
  }

  public start() {
    this.server = Bun.listen({
      hostname: this.config.host,
      port: this.config.port,
      socket: {
        data: (socket, data) => {
          this.handleData(socket, data);
        },
        error: (socket, error) => {
          console.error("Redis Socket Error:", error);
        },
      },
    });
    console.log(`[Redis Adapter] Listening on redis://${this.config.host}:${this.config.port}`);
  }

  public stop() {
    if (this.server) {
      this.server.stop();
      console.log("[Redis Adapter] Server stopped");
    }
  }

  private handleData(socket: any, data: Buffer) {
    // Basic state attached to socket for partial reads and namespaces
    if (!socket.data.buffer) socket.data.buffer = Buffer.alloc(0);
    if (!socket.data.namespace) socket.data.namespace = undefined;

    socket.data.buffer = Buffer.concat([socket.data.buffer, data]);

    const { commands, offset } = RESP.parse(socket.data.buffer);
    socket.data.buffer = socket.data.buffer.subarray(offset);

    for (const cmdArgs of commands) {
      if (cmdArgs.length === 0) continue;
      const cmd = cmdArgs[0].toUpperCase();
      const args = cmdArgs.slice(1);
      const ns = socket.data.namespace;

      let response = "";

      try {
        switch (cmd) {
          case "PING":
            response = args.length > 0 ? RESP.bulkString(args[0]) : RESP.simpleString("PONG");
            break;

          case "ECHO":
            response = RESP.bulkString(args[0] ?? "");
            break;

          case "GET":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'get' command");
            else {
              const val = this.cache.get(args[0], ns);
              response = RESP.bulkString(val);
            }
            break;

          case "SET":
            if (args.length < 2) response = RESP.error("ERR wrong number of arguments for 'set' command");
            else {
              // Basic SET key value (ignoring EX/PX for MVP simplicity unless specifically needed)
              // We'll support EX (seconds) or PX (milliseconds)
              let ttl = 0;
              if (args.length >= 4) {
                const opt = args[2].toUpperCase();
                if (opt === "EX") ttl = parseInt(args[3], 10) * 1000;
                else if (opt === "PX") ttl = parseInt(args[3], 10);
              }
              const ok = this.cache.set(args[0], args[1], ttl, ns);
              response = ok ? RESP.simpleString("OK") : RESP.error("ERR internal error");
            }
            break;

          case "DEL":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'del' command");
            else {
              let deleted = 0;
              for (const key of args) {
                if (this.cache.delete(key, ns)) deleted++;
              }
              response = RESP.integer(deleted);
            }
            break;

          case "EXISTS":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'exists' command");
            else {
              let existsCount = 0;
              for (const key of args) {
                if (this.cache.has(key, ns)) existsCount++;
              }
              response = RESP.integer(existsCount);
            }
            break;

          case "INCR":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'incr' command");
            else {
              const res = this.cache.incr(args[0], 1, ns);
              response = res.ok ? RESP.integer(res.value) : RESP.error(`ERR ${res.error}`);
            }
            break;

          case "DECR":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'decr' command");
            else {
              const res = this.cache.decr(args[0], 1, ns);
              response = res.ok ? RESP.integer(res.value) : RESP.error(`ERR ${res.error}`);
            }
            break;

          case "INCRBY":
            if (args.length < 2) response = RESP.error("ERR wrong number of arguments for 'incrby' command");
            else {
              const res = this.cache.incr(args[0], parseInt(args[1], 10), ns);
              response = res.ok ? RESP.integer(res.value) : RESP.error(`ERR ${res.error}`);
            }
            break;

          case "DECRBY":
            if (args.length < 2) response = RESP.error("ERR wrong number of arguments for 'decrby' command");
            else {
              const res = this.cache.decr(args[0], parseInt(args[1], 10), ns);
              response = res.ok ? RESP.integer(res.value) : RESP.error(`ERR ${res.error}`);
            }
            break;

          case "MGET":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'mget' command");
            else {
              const results = this.cache.mget(args, ns);
              const items = args.map((k) => RESP.bulkString(results[k] ?? null));
              response = RESP.array(items);
            }
            break;

          case "MSET":
            if (args.length < 2 || args.length % 2 !== 0) response = RESP.error("ERR wrong number of arguments for 'mset' command");
            else {
              const entries = [];
              for (let i = 0; i < args.length; i += 2) {
                entries.push({ key: args[i], value: args[i + 1] });
              }
              this.cache.mset(entries, ns);
              response = RESP.simpleString("OK");
            }
            break;

          case "SELECT":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'select' command");
            else {
              socket.data.namespace = args[0] === "0" ? undefined : `db${args[0]}`;
              response = RESP.simpleString("OK");
            }
            break;

          case "FLUSHDB":
            // Note: In standard Redis this flushes current DB. 
            // We clear everything for now as we don't have per-namespace flush yet.
            this.cache.clear();
            response = RESP.simpleString("OK");
            break;

          case "DBSIZE":
            response = RESP.integer(this.cache.count());
            break;

          case "INFO":
            const stats = this.cache.stats();
            const info = `# Server\r\nredis_version:7.0.0 (Dunena Adapter)\r\n# Stats\r\nkeyspace_hits:${stats.hits}\r\nkeyspace_misses:${stats.misses}\r\n`;
            response = RESP.bulkString(info);
            break;
            
          case "KEYS":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'keys' command");
            else {
              const pattern = args[0].replace(/\*/g, ""); // basic fallback mapping
              const res = this.cache.keys(pattern || undefined, ns, 0, 1000);
              const items = res.keys.map(k => RESP.bulkString(k));
              response = RESP.array(items);
            }
            break;

          case "TTL":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'ttl' command");
            else {
              const ms = this.cache.ttl(args[0], ns);
              if (ms === -2) response = RESP.integer(-2); // Not found
              else if (ms === -1) response = RESP.integer(-1); // No TTL
              else response = RESP.integer(Math.ceil(ms / 1000));
            }
            break;

          case "PTTL":
            if (args.length < 1) response = RESP.error("ERR wrong number of arguments for 'pttl' command");
            else {
              const ms = this.cache.ttl(args[0], ns);
              response = RESP.integer(ms);
            }
            break;
            
          case "EXPIRE":
            if (args.length < 2) response = RESP.error("ERR wrong number of arguments for 'expire' command");
            else {
              const ok = this.cache.touch(args[0], parseInt(args[1], 10) * 1000, ns);
              response = RESP.integer(ok ? 1 : 0);
            }
            break;
            
          case "PEXPIRE":
            if (args.length < 2) response = RESP.error("ERR wrong number of arguments for 'pexpire' command");
            else {
              const ok = this.cache.touch(args[0], parseInt(args[1], 10), ns);
              response = RESP.integer(ok ? 1 : 0);
            }
            break;

          case "QUIT":
            response = RESP.simpleString("OK");
            socket.write(response);
            socket.end();
            continue;

          default:
            response = RESP.error(`ERR unknown command '${cmd}'`);
        }
      } catch (err) {
        response = RESP.error(`ERR internal adapter error: ${err instanceof Error ? err.message : String(err)}`);
      }

      socket.write(response);
    }
  }
}
