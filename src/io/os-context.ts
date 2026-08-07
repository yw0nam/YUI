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
import type { OsEventListen, OsEventPayload } from "./tauri-listen";
import { subscribeOsEvent } from "./tauri-listen";

const log = createLogger("os-context");

export type { OsEventPayload } from "./tauri-listen";

export interface OsContextSnapshot {
  activeApp?: string;
  activeWindowTitle?: string;
}

export interface RecentApp {
  name: string;
  ts: number;
}

export interface OsContext {
  get(): OsContextSnapshot;
  start(): Promise<void>;
  stop(): void;
  /** Removes buffered app switches and returns them. With `only` (a prior peek snapshot),
   * removes just those entries by identity — anything pushed after the peek survives, so a
   * switch that lands mid-request isn't lost. Without `only`, drains the whole buffer. */
  drainRecentApps(only?: RecentApp[]): RecentApp[];
  /** Returns a copy of the buffered app switches without clearing the buffer. */
  peekRecentApps(): RecentApp[];
}

/** A non-empty string, else undefined (null/empty are ignored). */
function nonEmpty(v: string | null | undefined): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export function createOsContext(opts?: {
  listen?: OsEventListen;
  /** Live cap read. Not injected → buffer is uncapped (no trim applied); the production
   * wiring (main.ts) always injects this from the recent-apps store. */
  maxRecentApps?: () => number;
}): OsContext {
  let snapshot: OsContextSnapshot = {};
  let unlisten: (() => void) | undefined;
  let recentApps: RecentApp[] = [];

  function get(): OsContextSnapshot {
    return snapshot;
  }

  /** Drops the oldest entries down to the live cap. No-op when maxRecentApps isn't injected. */
  function trimToCap(): void {
    const max = opts?.maxRecentApps?.();
    if (max === undefined) return;
    while (recentApps.length > max) recentApps.shift();
  }

  function peekRecentApps(): RecentApp[] {
    trimToCap();
    return [...recentApps];
  }

  function drainRecentApps(only?: RecentApp[]): RecentApp[] {
    trimToCap();
    if (only === undefined) {
      const drained = recentApps;
      recentApps = [];
      return drained;
    }
    // Remove exactly the snapshotted entries (identity match). Entries pushed after the peek
    // stay in the buffer and carry over to the next turn.
    const drop = new Set(only);
    const removed = recentApps.filter((a) => drop.has(a));
    recentApps = recentApps.filter((a) => !drop.has(a));
    return removed;
  }

  function onEvent(payload: OsEventPayload): void {
    // Only foreground-app changes touch the app/title snapshot. Idle ticks and
    // fullscreen events are owned by other sources, not consumed here.
    if (payload.event_name !== "active_app_changed") return;
    const app = nonEmpty(payload.data.active_app_name);
    // A new app may have no readable title — clear it rather than carry the old one.
    const title = nonEmpty(payload.data.active_window_title);
    snapshot = {
      ...snapshot,
      ...(app ? { activeApp: app } : {}),
      activeWindowTitle: title,
    };
    if (app) {
      recentApps.push({ name: app, ts: payload.ts });
      trimToCap();
    }
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    unlisten = await subscribeOsEvent({ listen: opts?.listen, onTick: onEvent, log });
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
  }

  return { get, start, stop, drainRecentApps, peekRecentApps };
}
