/**
 * OS context snapshot holder (#18).
 *
 * Subscribes to the Rust `os_event` IPC channel and keeps a mutable snapshot of
 * the foreground app + window title. backend-caller reads `get()` to auto-attach
 * `env.active_app` / `env.active_window_title` to every request.
 *
 * Read-side only: this does NOT push os events to the dispatcher (#24). The
 * snapshot holder is the seam #24 can later extend for firing.
 */

import { createLogger } from "../logger";

const log = createLogger("os-context");

/** `os_event` channel payload — mirrors src-tauri OsEventPayload (snake_case over IPC). */
export interface OsEventPayload {
  event_name: string;
  ts: number;
  data: {
    active_app_name?: string | null;
    active_window_title?: string | null;
    os_idle_ms?: number | null;
    is_fullscreen?: boolean | null;
  };
}

export interface OsContextSnapshot {
  activeApp?: string;
  activeWindowTitle?: string;
}

export interface OsContext {
  get(): OsContextSnapshot;
  start(): Promise<void>;
  stop(): void;
}

/** Tauri event `listen` signature (injectable for tests). */
export type OsEventListen = (
  event: string,
  handler: (e: { payload: OsEventPayload }) => void,
) => Promise<() => void>;

const OS_EVENT_CHANNEL = "os_event";

/** A non-empty string, else undefined (null/empty are ignored). */
function nonEmpty(v: string | null | undefined): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Resolve the real Tauri `listen`, but only under the Tauri runtime. */
async function resolveTauriListen(): Promise<OsEventListen | undefined> {
  if (!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return undefined;
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen as unknown as OsEventListen;
}

export function createOsContext(opts?: { listen?: OsEventListen }): OsContext {
  let snapshot: OsContextSnapshot = {};
  let unlisten: (() => void) | undefined;

  function get(): OsContextSnapshot {
    return snapshot;
  }

  function onEvent(payload: OsEventPayload): void {
    // Only foreground-app changes touch the app/title snapshot. Idle / fullscreen /
    // camera events carry no app identity here (#24 may consume them separately).
    if (payload.event_name !== "active_app_changed") return;
    const app = nonEmpty(payload.data.active_app_name);
    // A new app may have no readable title — clear it rather than carry the old one.
    const title = nonEmpty(payload.data.active_window_title);
    snapshot = {
      ...snapshot,
      ...(app ? { activeApp: app } : {}),
      activeWindowTitle: title,
    };
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    let listen: OsEventListen | undefined;
    try {
      listen = opts?.listen ?? (await resolveTauriListen());
    } catch (err) {
      log.debug("listen resolve failed — degrade:", err);
      return;
    }
    if (!listen) return;
    try {
      unlisten = await listen(OS_EVENT_CHANNEL, ({ payload }) => onEvent(payload));
    } catch (err) {
      log.debug("subscribe failed — degrade:", err);
    }
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
  }

  return { get, start, stop };
}
