export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function isLevel(v: unknown): v is LogLevel {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

// dev → debug, prod → warn; VITE_YUI_LOG_LEVEL overrides when valid.
export function resolveLevel(env: { DEV?: boolean; VITE_YUI_LOG_LEVEL?: string }): LogLevel {
  if (isLevel(env.VITE_YUI_LOG_LEVEL)) return env.VITE_YUI_LOG_LEVEL;
  return env.DEV ? "debug" : "warn";
}

let currentLevel: LogLevel = resolveLevel(
  import.meta.env as { DEV?: boolean; VITE_YUI_LOG_LEVEL?: string },
);

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// plugin-log sink, populated by initLogger() in Tauri only.
type PluginLog = typeof import("@tauri-apps/plugin-log");
let sink: PluginLog | null = null;

export async function initLogger(): Promise<void> {
  if (!inTauri()) return;
  const mod = await import("@tauri-apps/plugin-log");
  sink = mod;
}

function fmtArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message;
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function emit(level: LogLevel, ns: string, msg: string, args: unknown[]): void {
  if (RANK[level] < RANK[currentLevel]) return;
  const line = `[YUI][${ns}] ${msg}`;
  if (sink) {
    void sink[level](args.length ? `${line} ${args.map(fmtArg).join(" ")}` : line);
    return;
  }
  console[level](line, ...args);
}

export function createLogger(namespace: string): Logger {
  return {
    debug: (msg, ...args) => emit("debug", namespace, msg, args),
    info: (msg, ...args) => emit("info", namespace, msg, args),
    warn: (msg, ...args) => emit("warn", namespace, msg, args),
    error: (msg, ...args) => emit("error", namespace, msg, args),
  };
}
