/**
 * Click-through hit-test controller (PHASE-1).
 *
 * Keeps the transparent pet window click-through (ignore cursor) over empty
 * space and interactive over the character / visible UI surfaces. A two-state
 * machine driven by hysteresis + debounce to avoid edge flicker:
 *
 * - CAPTURE (ignore=false): the webview gets events. A `pointermove` computes
 *   isOverInteractive; debounce_samples consecutive non-interactive samples →
 *   ignore=true, enter PASSTHROUGH, subscribe to the cursor source.
 * - PASSTHROUGH (ignore=true): the webview is blind. The shared cursor source
 *   (src/io/window/pet/cursor-source.ts) delivers the window-local cursor, and
 *   debounce_samples consecutive interactive samples → ignore=false, CAPTURE.
 *   A null sample (cursor unavailable, document hidden) returns to CAPTURE at once.
 *
 * Hysteresis: leaving CAPTURE rejects only when the cursor is outside the box
 * OUTSET by hysteresis_margin_px (within-margin counts as still interactive);
 * entering CAPTURE uses the tight box. Plus debounce_samples agreeing samples
 * and idempotent setIgnoreCursorEvents (skip if already in the desired state).
 *
 * Tauri-only: inert in a plain browser (mirrors src/io/window/pet/gesture/window-drag.ts's guard).
 */

import { invoke } from "@tauri-apps/api/core";
import type { HitTestKnobs } from "../../../config/validators/avatar/types";
import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import type { CursorSource, Vec2 } from "./cursor-source";

const log = createLogger("hit-test");

export type HitTestState = "capture" | "passthrough";

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Result of one state-machine step. */
interface TransitionResult {
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
  config: HitTestKnobs;
}): TransitionResult {
  const { state, interactive, counter, config } = args;
  const debounce = Math.max(1, config.debounce_samples);
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

/** The window surface the controller needs: the click-through flag. */
interface HitTestWindow {
  setIgnoreCursorEvents(ignore: boolean): Promise<void>;
}

export interface HitTestController {
  start(): void;
  stop(): void;
  /** Stop toggling and force the window interactive. */
  suspend(): void;
  /** Resume normal toggling. */
  resume(): void;
  /** Forwarded to the cursor source, which re-reads the window origin every tick while moving. */
  setMoving(moving: boolean): void;
}

interface HitTestOptions {
  /** The shared cursor source; subscribed only while in PASSTHROUGH. */
  cursor: Pick<CursorSource, "subscribe" | "setMoving">;
  /** Returns the live Tauri window. Default: createTauriHitTestWindow(). */
  getWindow?: () => HitTestWindow;
  /** EventTarget for pointermove in CAPTURE. Default: window. */
  moveTarget?: EventTarget;
  /**
   * Interactive predicate in window-local CSS px. `margin` is 0 when ENTERING
   * CAPTURE (tight box) and hysteresis_margin_px when LEAVING (outset box).
   */
  isOverInteractive: (xCss: number, yCss: number, marginPx: number) => boolean;
  /** The live configs/avatar.json hit_test block; the margin and debounce keys are read here. */
  getConfig: () => HitTestKnobs;
}

/**
 * Production HitTestWindow backed by the real Tauri window.
 * `setIgnoreCursorEvents` routes through the `set_click_through` command so
 * Windows child HWNDs (WebView2) also receive the EXSTYLE update.
 */
export function createTauriHitTestWindow(): HitTestWindow {
  return {
    setIgnoreCursorEvents: (ignore: boolean) => invoke<void>("set_click_through", { ignore }),
  };
}

export function createHitTestController(opts: HitTestOptions): HitTestController {
  // Mirror window-drag.ts: inert in a plain browser so Vite/browser dev still boots.
  if (!isTauri()) {
    log.debug("hit_test_disabled", { reason: "non_tauri" });
    return { start() {}, stop() {}, suspend() {}, resume() {}, setMoving() {} };
  }

  const getWindow = opts.getWindow ?? createTauriHitTestWindow;
  const moveTarget = opts.moveTarget ?? (globalThis as unknown as EventTarget);

  let win: HitTestWindow | null = null;
  let state: HitTestState = "capture";
  let counter = 0;
  // Tracked desired ignore state so setIgnoreCursorEvents is idempotent.
  let ignore = false;
  let running = false;
  let suspended = false;
  let unsubscribe: (() => void) | null = null;
  let ignoreChain = Promise.resolve();

  function margin(): number {
    return opts.getConfig().hysteresis_margin_px;
  }

  // Idempotent toggle — only hits IPC when the desired state actually changes.
  function setIgnore(next: boolean): void {
    if (ignore === next) return;
    ignore = next;
    const target = win;
    ignoreChain = ignoreChain.then(async () => {
      try {
        await target?.setIgnoreCursorEvents(next);
      } catch (err) {
        log.warn("set_ignore_failed", { ignore: next, error: String(err) });
      }
    });
  }

  function release(): void {
    unsubscribe?.();
    unsubscribe = null;
  }

  function toCapture(): void {
    state = "capture";
    counter = 0;
    release();
    setIgnore(false);
  }

  // Drive one transition from a sample, applying toggle + side effects.
  function applySample(interactive: boolean): void {
    const r = decideTransition({ state, interactive, counter, config: opts.getConfig() });
    state = r.state;
    counter = r.counter;
    if (!r.toggle) return;
    if (state === "capture") {
      toCapture();
      return;
    }
    setIgnore(true);
    unsubscribe = opts.cursor.subscribe(onCursor);
  }

  // PASSTHROUGH source: the shared cursor. Entering CAPTURE uses the tight box (margin 0).
  function onCursor(pos: Vec2 | null): void {
    if (pos === null) toCapture();
    else applySample(opts.isOverInteractive(pos.x, pos.y, 0));
  }

  // CAPTURE source: pointermove on the stage/window. Outset box (leaving).
  function onPointerMove(e: Event): void {
    if (!running || suspended || state !== "capture") return;
    const pe = e as PointerEvent;
    applySample(opts.isOverInteractive(pe.clientX, pe.clientY, margin()));
  }

  function start(): void {
    if (running) return;
    running = true;
    win = getWindow();
    state = "capture";
    counter = 0;
    // The OS-level flag outlives the page (webview crash / full reload), so push CAPTURE instead
    // of assuming it — a click-through window delivers no pointermove to correct the assumption.
    ignore = true;
    setIgnore(false);
    suspended = false;
    moveTarget.addEventListener("pointermove", onPointerMove);
  }

  function stop(): void {
    running = false;
    release();
    moveTarget.removeEventListener("pointermove", onPointerMove);
    // Leave the window interactive so teardown never strands click-through on.
    setIgnore(false);
    win = null;
  }

  function suspend(): void {
    suspended = true;
    toCapture();
  }

  function resume(): void {
    if (!suspended) return;
    suspended = false;
    toCapture();
  }

  return { start, stop, suspend, resume, setMoving: (moving) => opts.cursor.setMoving(moving) };
}
