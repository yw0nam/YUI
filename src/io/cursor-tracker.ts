/**
 * Global-cursor tracker — forwards the OS cursor (window-local CSS px) to the gaze apply
 * layer. Tauri: self-scheduled poll of the physical cursor via the same 4 reads hit-test's
 * poll uses, converted with physicalCursorToLocalCss. Non-Tauri: mousemove on the window
 * (keeps Vite browser dev testable).
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

/** Not yet implemented — TDD stub so the test commit type-checks while the tests fail. */
export function createCursorTracker(_opts: CursorTrackerOptions): CursorTrackerController {
  return {
    start() {},
    stop() {},
  };
}
