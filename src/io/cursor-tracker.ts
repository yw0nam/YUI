/**
 * Global-cursor tracker — forwards the OS cursor (window-local CSS px) to the gaze apply
 * layer. Tauri: self-scheduled poll of the physical cursor, converted with
 * physicalCursorToLocalCss; only cursorPosition() is read every tick, the slower
 * outerPosition/scaleFactor/primaryScaleFactor statics are cached and refreshed every
 * STATIC_REFRESH_TICKS ticks, or immediately on a window move/resize/scale-change event
 * (drag moves the window continuously, so the tick-based cadence alone would let the
 * cached origin drift and snap). Non-Tauri: mousemove/mouseleave on the window (keeps
 * Vite browser dev testable).
 */

import { cursorPosition, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { createLogger } from "../logger";
import { physicalCursorToLocalCss } from "./hit-test";
import { isTauri } from "./tauri-env";
import {
  createWindowStatics,
  STATIC_REFRESH_TICKS,
  type Vec2,
  type WindowStaticsSource,
} from "./window-statics";

const log = createLogger("cursor-tracker");

/** Poll cadence while the cursor read is healthy (ms). */
const POLL_MS = 33;
/** Poll cadence after FAILURE_THRESHOLD consecutive read failures, until one succeeds (ms). */
const BACKOFF_MS = 1000;
/** Consecutive poll failures before reporting the cursor unavailable and backing off. */
const FAILURE_THRESHOLD = 3;

/** The window surface the tracker needs: exactly what the statics cache reads and listens to. */
export type CursorTrackerWindow = WindowStaticsSource;

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
    onMoved: (cb) => w.onMoved(() => cb()),
    onResized: (cb) => w.onResized(() => cb()),
    onScaleChanged: (cb) => w.onScaleChanged(() => cb()),
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
  // Window origin and scale factors, re-read every STATIC_REFRESH_TICKS.
  const statics = createWindowStatics();

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
    const refreshStatics = statics.origin === null || tick % STATIC_REFRESH_TICKS === 0;
    tick++;
    try {
      const cursor = await statics.readCursor(win, refreshStatics);
      // Teardown (or hide) may have happened while these reads were in flight.
      if (!running || doc.visibilityState === "hidden") return;
      // A move/resize/scale-change can invalidate the cache while a cached tick's
      // cursorPosition() is still in flight — skip this sample (don't return: the
      // reschedule below must still run, or the loop dies with gaze frozen).
      const origin = statics.origin;
      if (origin !== null) {
        if (backoff) log.warn("poll_recovered", {});
        failureCount = 0;
        backoff = false;
        opts.onCursor(physicalCursorToLocalCss(cursor, origin, statics.scale, statics.cursorScale));
      }
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
      statics.invalidate();
      statics.subscribe(win);
      doc.addEventListener("visibilitychange", onVisibilityChange);
      if (doc.visibilityState !== "hidden") scheduleNextPoll(POLL_MS);
    },
    stop() {
      running = false;
      stopPoll();
      statics.unsubscribe();
      doc.removeEventListener("visibilitychange", onVisibilityChange);
      win = null;
    },
  };
}
