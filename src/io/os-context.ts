/**
 * OS context snapshot holder.
 *
 * Subscribes to the Rust `os_event` IPC channel and keeps a mutable snapshot of
 * the foreground app + window title. backend-caller reads `get()` to auto-attach
 * `env.active_app` / `env.active_window_title` to every request.
 *
 * Read-side only: this does NOT push os events to the dispatcher. The
 * snapshot holder is the seam that can later extend for firing.
 */

import { createLogger } from "../logger";
import {
  OS_EVENT_CHANNEL,
  type OsEventListen,
  type OsEventPayload,
  resolveTauriListen,
} from "./tauri-listen";

const log = createLogger("os-context");

export type { OsEventPayload } from "./tauri-listen";

export interface OsContextSnapshot {
  activeApp?: string;
  activeWindowTitle?: string;
  isFullscreen?: boolean;
}

export interface OsContext {
  get(): OsContextSnapshot;
  start(): Promise<void>;
  stop(): void;
}

/** A non-empty string, else undefined (null/empty are ignored). */
function nonEmpty(v: string | null | undefined): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function createOsContext(opts?: { listen?: OsEventListen }): OsContext {
  let snapshot: OsContextSnapshot = {};
  let unlisten: (() => void) | undefined;

  function get(): OsContextSnapshot {
    return snapshot;
  }

  function onEvent(payload: OsEventPayload): void {
    // Fullscreen events carry no app identity — only flip the isFullscreen flag.
    if (payload.event_name === "fullscreen_entered" || payload.event_name === "fullscreen_exited") {
      snapshot = { ...snapshot, isFullscreen: payload.data.is_fullscreen === true };
      return;
    }
    // Only foreground-app changes touch the app/title snapshot. Idle ticks are
    // owned by the cowork source, not consumed here.
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
