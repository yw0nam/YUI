/**
 * Global-cursor tracker — forwards the OS cursor (window-local CSS px) to the gaze apply
 * layer. Tauri: self-scheduled poll of the physical cursor, converted with
 * physicalCursorToLocalCss; only cursorPosition() is read every tick, the slower
 * outerPosition/scaleFactor/primaryScaleFactor statics are cached and refreshed every
 * STATIC_REFRESH_TICKS ticks. Non-Tauri: mousemove/mouseleave on the window (keeps Vite
 * browser dev testable).
 */

import { cursorPosition, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { createLogger } from "../logger";
import { physicalCursorToLocalCss } from "./hit-test";
import { isTauri } from "./tauri-env";

const log = createLogger("cursor-tracker");

/** Poll cadence while the cursor read is healthy (ms). */
const POLL_MS = 33;
/** Poll cadence after FAILURE_THRESHOLD consecutive read failures, until one succeeds (ms). */
const BACKOFF_MS = 1000;
/** Consecutive poll failures before reporting the cursor unavailable and backing off. */
const FAILURE_THRESHOLD = 3;
/** Ticks between outerPosition/scaleFactor/primaryScaleFactor re-reads (~264ms at POLL_MS). */
const STATIC_REFRESH_TICKS = 8;

interface Vec2 {
  x: number;
  y: number;
}

/** Minimal window surface the tracker needs (Tauri @tauri-apps/api/window) — mirrors hit-test's poll reads. */
export interface CursorTrackerWindow {
  cursorPosition(): Promise<Vec2>;
  outerPosition(): Promise<Vec2>;
  scaleFactor(): Promise<number>;
  /** Scale factor the cursor reading is expressed in — the primary monitor's. Falls back to scaleFactor(). */
  primaryScaleFactor?(): Promise<number>;
}

export interface CursorTrackerController {
  start(): void;
  stop(): void;
}

interface CursorTrackerOptions {
  /** Window-local CSS px cursor position; null when unavailable. */
  onCursor: (pos: Vec2 | null) => void;
  /** Returns the live Tauri window. Default: createTauriCursorWindow(). */
  getWindow?: () => CursorTrackerWindow;
  /** setTimeout seam (testability). Default: globalThis.setTimeout. */
  schedule?: (cb: () => void, ms: number) => number;
  /** clearTimeout seam. Default: globalThis.clearTimeout. */
  cancel?: (handle: number) => void;
  /** EventTarget for mousemove in the non-Tauri path. Default: window. */
  moveTarget?: EventTarget;
  /** Document seam for visibility (pauses polling while hidden). Default: document. */
  doc?: Document;
}

/** Production CursorTrackerWindow — the same 4 reads hit-test's poll uses. */
export function createTauriCursorWindow(): CursorTrackerWindow {
  const w = getCurrentWindow();
  return {
    cursorPosition: () => cursorPosition(),
    outerPosition: () => w.outerPosition(),
    scaleFactor: () => w.scaleFactor(),
    primaryScaleFactor: async () =>
      (await primaryMonitor())?.scaleFactor ?? (await w.scaleFactor()),
  };
}

/**
 * Global OS-cursor tracker. Tauri: polls cursorPosition/outerPosition/scaleFactor/
 * primaryScaleFactor every POLL_MS, converts via physicalCursorToLocalCss, and reports
 * window-local CSS px. Degrades to BACKOFF_MS after FAILURE_THRESHOLD consecutive read
 * failures (Windows cursorPosition() intermittently throws) and reports null until a poll
 * succeeds, then restores POLL_MS. Pauses while the document is hidden. Non-Tauri: forwards
 * mousemove.
 */
export function createCursorTracker(opts: CursorTrackerOptions): CursorTrackerController {
  if (!isTauri()) {
    const moveTarget = opts.moveTarget ?? (globalThis as unknown as EventTarget);
    const onMove = (e: Event): void => {
      const me = e as MouseEvent;
      opts.onCursor({ x: me.clientX, y: me.clientY });
    };
    const onLeave = (): void => opts.onCursor(null);
    return {
      start() {
        moveTarget.addEventListener("mousemove", onMove);
        moveTarget.addEventListener("mouseleave", onLeave);
      },
      stop() {
        moveTarget.removeEventListener("mousemove", onMove);
        moveTarget.removeEventListener("mouseleave", onLeave);
      },
    };
  }

  const getWindow = opts.getWindow ?? createTauriCursorWindow;
  const schedule =
    opts.schedule ?? ((cb, ms) => globalThis.setTimeout(cb, ms) as unknown as number);
  const cancel = opts.cancel ?? ((h) => globalThis.clearTimeout(h));
  const doc = opts.doc ?? document;

  let win: CursorTrackerWindow | null = null;
  let running = false;
  let pollHandle: number | null = null;
  let failureCount = 0;
  let backoff = false;
  let tick = 0;
  // Cached slow statics — re-read every STATIC_REFRESH_TICKS; null forces a refresh.
  let cachedOrigin: Vec2 | null = null;
  let cachedSf = 1;
  let cachedCursorSf = 1;

  function stopPoll(): void {
    if (pollHandle !== null) {
      cancel(pollHandle);
      pollHandle = null;
    }
  }

  function scheduleNextPoll(ms: number): void {
    stopPoll();
    pollHandle = schedule(() => {
      void poll();
    }, ms);
  }

  async function poll(): Promise<void> {
    if (!running || !win) return;
    const refreshStatics = cachedOrigin === null || tick % STATIC_REFRESH_TICKS === 0;
    tick++;
    try {
      let cursor: Vec2;
      if (refreshStatics) {
        const [c, origin, sf, cursorSf] = await Promise.all([
          win.cursorPosition(),
          win.outerPosition(),
          win.scaleFactor(),
          win.primaryScaleFactor?.(),
        ]);
        cursor = c;
        cachedOrigin = origin;
        cachedSf = sf;
        cachedCursorSf = cursorSf ?? sf;
      } else {
        cursor = await win.cursorPosition();
      }
      // Teardown (or hide) may have happened while these reads were in flight.
      if (!running || doc.visibilityState === "hidden" || cachedOrigin === null) return;
      if (backoff) log.warn("poll_recovered", {});
      failureCount = 0;
      backoff = false;
      opts.onCursor(physicalCursorToLocalCss(cursor, cachedOrigin, cachedSf, cachedCursorSf));
    } catch (err) {
      failureCount++;
      if (backoff) {
        log.debug("poll_failed", { error: String(err) });
      } else {
        log.warn("poll_failed", { error: String(err) });
      }
      if (failureCount === FAILURE_THRESHOLD) {
        backoff = true;
        log.warn("poll_failure_threshold_reached", { backoff_ms: BACKOFF_MS });
        opts.onCursor(null);
      }
    }
    if (running && doc.visibilityState !== "hidden") {
      scheduleNextPoll(backoff ? BACKOFF_MS : POLL_MS);
    }
  }

  function onVisibilityChange(): void {
    if (doc.visibilityState === "hidden") {
      stopPoll();
      opts.onCursor(null);
    } else if (running && pollHandle === null) {
      scheduleNextPoll(backoff ? BACKOFF_MS : POLL_MS);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      win = getWindow();
      failureCount = 0;
      backoff = false;
      tick = 0;
      cachedOrigin = null;
      doc.addEventListener("visibilitychange", onVisibilityChange);
      if (doc.visibilityState !== "hidden") scheduleNextPoll(POLL_MS);
    },
    stop() {
      running = false;
      stopPoll();
      doc.removeEventListener("visibilitychange", onVisibilityChange);
      win = null;
    },
  };
}
