/**
 * Scoped, level-gated logger for the core package. Silent below "warn" by
 * default; enable verbose output per environment via
 * localStorage["zvonok:log-level"] (e.g. "debug") or the VITE_ZVONOK_LOG
 * variable. Levels: debug < info < warn < error.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LEVEL_STORAGE_KEY = "zvonok:log-level";

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && value in LEVEL_ORDER;
}

function resolveLevel(): LogLevel {
  // localStorage wins: it works in production builds without a rebuild.
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(LEVEL_STORAGE_KEY);
      if (isLogLevel(stored)) {
        return stored;
      }
    }
  } catch {
    // Storage can throw in private-mode embeddings; fall through to env.
  }
  const env = (import.meta.env ?? {}) as { VITE_ZVONOK_LOG?: string };
  if (isLogLevel(env.VITE_ZVONOK_LOG)) {
    return env.VITE_ZVONOK_LOG;
  }
  return "warn";
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Creates a logger whose every line is prefixed with `[zvonok:<scope>]`. */
export function createLogger(scope: string): Logger {
  const prefix = `[zvonok:${scope}]`;
  const write = (level: LogLevel, args: unknown[]) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[resolveLevel()]) {
      return;
    }
    const method = level === "debug" ? "log" : level;
    console[method](prefix, ...args);
  };
  return {
    debug: (...args) => write("debug", args),
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args),
  };
}
