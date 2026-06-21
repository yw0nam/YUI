/**
 * Click-through hit-test controller (PHASE-1).
 *
 * Keeps the transparent pet window click-through (ignore cursor) over empty
 * space and interactive over the character / visible UI surfaces. A two-state
 * machine driven by hysteresis + debounce to avoid edge flicker:
 *
 * - CAPTURE (ignore=false): the webview gets events. A `pointermove` computes
 *   isOverInteractive; debounce_samples consecutive non-interactive samples →
 *   ignore=true, enter PASSTHROUGH, start the poll.
 * - PASSTHROUGH (ignore=true): the webview is blind. A self-scheduled poll reads
 *   the screen-global PHYSICAL cursor, converts to window-local CSS px, and
 *   debounce_samples consecutive interactive samples → ignore=false, CAPTURE.
 *
 * Hysteresis: leaving CAPTURE rejects only when the cursor is outside the box
 * OUTSET by hysteresis_margin_px (within-margin counts as still interactive);
 * entering CAPTURE uses the tight box. Plus debounce_samples agreeing samples
 * and idempotent setIgnoreCursorEvents (skip if already in the desired state).
 *
 * Tauri-only: inert in a plain browser (mirrors src/drag.ts's guard).
 */

import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { createLogger } from "../logger";

const log = createLogger("hit-test");

/** configs/avatar.json hit_test knobs (all optional; controller fills defaults). */
export interface HitTestConfig {
  hysteresis_margin_px?: number;
  poll_interval_ms?: number;
  debounce_samples?: number;
  /** Reserved for phase-2 alpha sampling. */
  alpha_threshold?: number;
}

const DEFAULTS = {
  hysteresis_margin_px: 8,
  poll_interval_ms: 200,
  debounce_samples: 2,
} as const;

export type HitTestState = "capture" | "passthrough";

interface Vec2 {
  x: number;
  y: number;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Convert a screen-global PHYSICAL cursor to window-local CSS/logical px.
 * `localLogical = (cursorPhys − windowOuterPhys) / scaleFactor`.
 * scaleFactor ≤ 0 falls back to 1 (never divide by zero).
 */
export function physicalCursorToLocalCss(
  cursorPhys: Vec2,
  windowOuterPhys: Vec2,
  scaleFactor: number,
): Vec2 {
  const sf = scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: (cursorPhys.x - windowOuterPhys.x) / sf,
    y: (cursorPhys.y - windowOuterPhys.y) / sf,
  };
}

/** Result of one state-machine step. */
export interface TransitionResult {
  state: HitTestState;
  /** True when the caller should flip setIgnoreCursorEvents to the new state. */
  toggle: boolean;
  /** Debounce counter carried into the next step. */
  counter: number;
}

/**
 * One step of the hysteresis/debounce state machine. Pure.
 *
 * `interactive` is the (margin-aware) sample for this tick. A sample that
 * agrees with the current state resets the counter (no flicker on a blip). A
 * disagreeing sample increments the counter; once it reaches debounce_samples
 * the state flips and `toggle` is set. Idempotent: agreeing never toggles.
 */
export function decideTransition(args: {
  state: HitTestState;
  interactive: boolean;
  counter: number;
  config: HitTestConfig;
}): TransitionResult {
  const { state, interactive, counter, config } = args;
  const debounce = Math.max(1, config.debounce_samples ?? DEFAULTS.debounce_samples);
  // The state the sample is pushing toward.
  const want: HitTestState = interactive ? "capture" : "passthrough";
  if (want === state) {
    return { state, toggle: false, counter: 0 };
  }
  const next = counter + 1;
  if (next >= debounce) {
    return { state: want, toggle: true, counter: 0 };
  }
  return { state, toggle: false, counter: next };
}

// ─── Controller ──────────────────────────────────────────────────────────────

/** Minimal window surface the controller needs (Tauri @tauri-apps/api/window). */
export interface HitTestWindow {
  cursorPosition(): Promise<Vec2>;
  setIgnoreCursorEvents(ignore: boolean): Promise<void>;
  outerPosition(): Promise<Vec2>;
  scaleFactor(): Promise<number>;
}

export interface HitTestController {
  start(): void;
  stop(): void;
  /** Force CAPTURE (ignore=false) and stop toggling — wire to onDragStart. */
  suspend(): void;
  /** Resume normal toggling — wire to onDragEnd. */
  resume(): void;
}

export interface HitTestOptions {
  /** Returns the live Tauri window. Default: getCurrentWindow(). */
  getWindow?: () => HitTestWindow;
  /** EventTarget for pointermove in CAPTURE. Default: window. */
  moveTarget?: EventTarget;
  /**
   * Interactive predicate in window-local CSS px. `margin` is 0 when ENTERING
   * CAPTURE (tight box) and hysteresis_margin_px when LEAVING (outset box).
   */
  isOverInteractive: (xCss: number, yCss: number, marginPx: number) => boolean;
  getConfig: () => HitTestConfig;
  /** setTimeout seam (testability). Default: globalThis.setTimeout. */
  schedule?: (cb: () => void, ms: number) => number;
  /** clearTimeout seam. Default: globalThis.clearTimeout. */
  cancel?: (handle: number) => void;
}

function isTauri(): boolean {
  return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

/**
 * Production HitTestWindow backed by the real Tauri window.
 * `setIgnoreCursorEvents` routes through the `set_click_through` command so
 * Windows child HWNDs (WebView2) also receive the EXSTYLE update.
 */
export function createTauriHitTestWindow(): HitTestWindow {
  const w = getCurrentWindow();
  return {
    cursorPosition: () => cursorPosition(),
    setIgnoreCursorEvents: (ignore: boolean) => invoke<void>("set_click_through", { ignore }),
    outerPosition: () => w.outerPosition(),
    scaleFactor: () => w.scaleFactor(),
  };
}

export function createHitTestController(opts: HitTestOptions): HitTestController {
  // Mirror drag.ts: inert in a plain browser so Vite/browser dev still boots.
  if (!isTauri()) {
    log.debug("hit_test_disabled", { reason: "non_tauri" });
    return { start() {}, stop() {}, suspend() {}, resume() {} };
  }

  const getWindow = opts.getWindow ?? createTauriHitTestWindow;
  const moveTarget = opts.moveTarget ?? (globalThis as unknown as EventTarget);
  const schedule =
    opts.schedule ?? ((cb, ms) => globalThis.setTimeout(cb, ms) as unknown as number);
  const cancel = opts.cancel ?? ((h) => globalThis.clearTimeout(h));

  let win: HitTestWindow | null = null;
  let state: HitTestState = "capture";
  let counter = 0;
  // Tracked desired ignore state so setIgnoreCursorEvents is idempotent.
  let ignore = false;
  let running = false;
  let suspended = false;
  let pollHandle: number | null = null;

  function margin(): number {
    return opts.getConfig().hysteresis_margin_px ?? DEFAULTS.hysteresis_margin_px;
  }

  // Idempotent toggle — only hits IPC when the desired state actually changes.
  function setIgnore(next: boolean): void {
    if (ignore === next) return;
    ignore = next;
    win?.setIgnoreCursorEvents(next).catch((err: unknown) => {
      log.warn("set_ignore_failed", { ignore: next, error: String(err) });
    });
  }

  // Drive one transition from a sample, applying toggle + side effects.
  function applySample(interactive: boolean): void {
    const r = decideTransition({ state, interactive, counter, config: opts.getConfig() });
    state = r.state;
    counter = r.counter;
    if (r.toggle) {
      if (state === "passthrough") {
        setIgnore(true);
        scheduleNextPoll();
      } else {
        setIgnore(false);
        stopPoll();
      }
    }
  }

  // CAPTURE source: pointermove on the stage/window. Outset box (leaving).
  function onPointerMove(e: Event): void {
    if (!running || suspended || state !== "capture") return;
    const pe = e as PointerEvent;
    applySample(opts.isOverInteractive(pe.clientX, pe.clientY, margin()));
  }

  function stopPoll(): void {
    if (pollHandle !== null) {
      cancel(pollHandle);
      pollHandle = null;
    }
  }

  function scheduleNextPoll(): void {
    stopPoll();
    const ms = opts.getConfig().poll_interval_ms ?? DEFAULTS.poll_interval_ms;
    pollHandle = schedule(() => {
      void poll();
    }, ms);
  }

  // PASSTHROUGH loop: webview is blind, so read the global cursor and convert.
  async function poll(): Promise<void> {
    if (!running || suspended || state !== "passthrough" || !win) return;
    try {
      const [cursor, origin, sf] = await Promise.all([
        win.cursorPosition(),
        win.outerPosition(),
        win.scaleFactor(),
      ]);
      const local = physicalCursorToLocalCss(cursor, origin, sf);
      // Entering CAPTURE uses the tight box (margin 0).
      applySample(opts.isOverInteractive(local.x, local.y, 0));
    } catch (err) {
      log.warn("poll_failed", { error: String(err) });
    }
    if (running && !suspended && state === "passthrough") scheduleNextPoll();
  }

  function start(): void {
    if (running) return;
    running = true;
    win = getWindow();
    state = "capture";
    counter = 0;
    ignore = false;
    moveTarget.addEventListener("pointermove", onPointerMove);
  }

  function stop(): void {
    running = false;
    stopPoll();
    moveTarget.removeEventListener("pointermove", onPointerMove);
    // Leave the window interactive so teardown never strands click-through on.
    setIgnore(false);
    win = null;
  }

  function suspend(): void {
    suspended = true;
    state = "capture";
    counter = 0;
    stopPoll();
    setIgnore(false);
  }

  function resume(): void {
    suspended = false;
    state = "capture";
    counter = 0;
  }

  return { start, stop, suspend, resume };
}
