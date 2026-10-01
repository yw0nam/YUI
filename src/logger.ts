import { isTauri } from "./tauri-env";

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

// dev → debug, prod → warn; VITE_YUI_LOG_LEVEL overrides when valid. Values are read as static
// property accesses at the call site — passing the whole env object would inline every VITE_*
// value (build-time keys included) into the bundle.
export function resolveLevel(dev: boolean | undefined, level: string | undefined): LogLevel {
  if (isLevel(level)) return level;
  return dev ? "debug" : "warn";
}

const currentLevel: LogLevel = resolveLevel(
  import.meta.env.DEV,
  import.meta.env.VITE_YUI_LOG_LEVEL,
);

// plugin-log sink, populated by initLogger() in Tauri only.
type PluginLog = typeof import("@tauri-apps/plugin-log");
let sink: PluginLog | null = null;

export async function initLogger(): Promise<void> {
  if (!isTauri()) return;
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
