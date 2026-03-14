// ── Structured Logger ──────────────────────────────────────
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const RESET = "\x1b[0m";

export class Logger {
  private minLevel: number;
  private json: boolean;
  private prefix: string;

  constructor(
    level: LogLevel = "info",
    format: "text" | "json" = "text",
    prefix = "dunena"
  ) {
    this.minLevel = LEVEL_PRIORITY[level];
    this.json = format === "json";
    this.prefix = prefix;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (LEVEL_PRIORITY[level] < this.minLevel) return;

    if (this.json) {
      const entry = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...meta,
      };
      console.log(JSON.stringify(entry));
    } else {
      const color = LEVEL_COLORS[level];
      const ts = new Date().toISOString().slice(11, 23);
      const lvl = level.toUpperCase().padEnd(5);
      const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
      console.log(
        `${color}[${ts}] ${lvl}${RESET} [${this.prefix}] ${message}${metaStr}`
      );
    }
  }

  debug(msg: string, meta?: Record<string, unknown>) {
    this.log("debug", msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>) {
    this.log("info", msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>) {
    this.log("warn", msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>) {
    this.log("error", msg, meta);
  }

  child(prefix: string): Logger {
    return new Logger(
      (Object.entries(LEVEL_PRIORITY).find(
        ([, v]) => v === this.minLevel
      )?.[0] ?? "info") as LogLevel,
      this.json ? "json" : "text",
      `${this.prefix}:${prefix}`
    );
  }
}

export const logger = new Logger(
  (process.env.DUNENA_LOG_LEVEL as LogLevel) ?? "info",
  (process.env.DUNENA_LOG_FORMAT as "text" | "json") ?? "text"
);
