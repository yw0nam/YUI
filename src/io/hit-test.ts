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
 *   Only cursorPosition() is read every tick; outerPosition/scaleFactor/
 *   primaryScaleFactor are cached and refreshed every STATIC_REFRESH_TICKS
 *   ticks, or immediately on a window move/resize/scale-change event (mirrors
 *   src/io/cursor-tracker.ts).
 *
 * Hysteresis: leaving CAPTURE rejects only when the cursor is outside the box
 * OUTSET by hysteresis_margin_px (within-margin counts as still interactive);
 * entering CAPTURE uses the tight box. Plus debounce_samples agreeing samples
 * and idempotent setIgnoreCursorEvents (skip if already in the desired state).
 *
 * Tauri-only: inert in a plain browser (mirrors src/drag.ts's guard).
 */

import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { createLogger } from "../logger";
import { isTauri } from "./tauri-env";

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
  poll_interval_ms: 33,
  debounce_samples: 2,
} as const;

export type HitTestState = "capture" | "passthrough";

interface Vec2 {
  x: number;
  y: number;
}

/** Unsubscribe handle returned by a Tauri event listener. */
type Unlisten = () => void;

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Convert a screen-global PHYSICAL cursor to window-local CSS/logical px.
 *
 * Both readings describe the same screen-global point space, but each arrives scaled by a
 * different monitor's factor: the cursor by the primary monitor's, the window origin by the
 * factor of the monitor the window sits on. Dividing each by its own factor recovers the shared
 * space — `localLogical = cursorPhys / cursorScaleFactor − windowOuterPhys / scaleFactor`. On a
 * uniform-DPI setup the two factors are equal and this reduces to the single-factor form, so
 * cursorScaleFactor defaults to scaleFactor. Either factor ≤ 0 falls back to 1 (never divide by
 * zero).
 */
export function physicalCursorToLocalCss(
  cursorPhys: Vec2,
  windowOuterPhys: Vec2,
  scaleFactor: number,
  cursorScaleFactor: number = scaleFactor,
): Vec2 {
  const sf = scaleFactor > 0 ? scaleFactor : 1;
  const cf = cursorScaleFactor > 0 ? cursorScaleFactor : 1;
  // Equal factors subtract first — dividing each term separately loses precision on 1.5.
  if (cf === sf) {
    return {
      x: (cursorPhys.x - windowOuterPhys.x) / sf,
      y: (cursorPhys.y - windowOuterPhys.y) / sf,
    };
  }
  return {
    x: cursorPhys.x / cf - windowOuterPhys.x / sf,
    y: cursorPhys.y / cf - windowOuterPhys.y / sf,
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
  /** Scale factor the cursor reading is expressed in — the primary monitor's. Falls back to scaleFactor(). */
  primaryScaleFactor?(): Promise<number>;
  /** Fires on window move/resize/DPI change — invalidates the cached statics. Non-Tauri: absent. */
  onMoved?(cb: () => void): Promise<Unlisten>;
  onResized?(cb: () => void): Promise<Unlisten>;
  onScaleChanged?(cb: () => void): Promise<Unlisten>;
}

export interface HitTestController {
  start(): void;
  stop(): void;
  /** Stop toggling, force the cursor mode, and assign suspension ownership. */
  suspend(mode?: "capture" | "passthrough", owner?: string): void;
  /** Resume normal toggling when the caller owns the suspension. */
  resume(owner?: string): void;
}

interface HitTestOptions {
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
  /** Document seam for visibility (gates the poll while hidden). Default: document. */
  doc?: Document;
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
    primaryScaleFactor: async () =>
      (await primaryMonitor())?.scaleFactor ?? (await w.scaleFactor()),
    onMoved: (cb) => w.onMoved(() => cb()),
    onResized: (cb) => w.onResized(() => cb()),
    onScaleChanged: (cb) => w.onScaleChanged(() => cb()),
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
  const doc = opts.doc ?? document;

  let win: HitTestWindow | null = null;
  let state: HitTestState = "capture";
  let counter = 0;
  // Tracked desired ignore state so setIgnoreCursorEvents is idempotent.
  let ignore = false;
  let running = false;
  let suspended = false;
  let suspendedOwner: string | null = null;
  let pollHandle: number | null = null;
  let ignoreChain = Promise.resolve();
  // Consecutive poll failures: after this many, degrade to CAPTURE.
  const POLL_FAILURE_THRESHOLD = 3;
  let pollFailureCount = 0;
  // Ticks between outerPosition/scaleFactor/primaryScaleFactor re-reads (mirrors cursor-tracker.ts).
  const STATIC_REFRESH_TICKS = 8;
  let tick = 0;
  // Cached slow statics — re-read every STATIC_REFRESH_TICKS; null forces a refresh.
  let cachedOrigin: Vec2 | null = null;
  let cachedSf = 1;
  let cachedCursorSf = 1;
  // Window move/resize/scale-change unlisten handles — awaited (not blocking start()) so a
  // stop() that lands before they resolve still unsubscribes once they do.
  let unlistenMoved: Promise<Unlisten> | null = null;
  let unlistenResized: Promise<Unlisten> | null = null;
  let unlistenScaleChanged: Promise<Unlisten> | null = null;

  function invalidateStatics(): void {
    cachedOrigin = null;
  }

  function subscribeWindowEvents(w: HitTestWindow): void {
    unlistenMoved = w.onMoved?.(invalidateStatics) ?? null;
    unlistenResized = w.onResized?.(invalidateStatics) ?? null;
    unlistenScaleChanged = w.onScaleChanged?.(invalidateStatics) ?? null;
  }

  function unsubscribeWindowEvents(): void {
    unlistenMoved?.then((fn) => fn()).catch(() => {});
    unlistenResized?.then((fn) => fn()).catch(() => {});
    unlistenScaleChanged?.then((fn) => fn()).catch(() => {});
    unlistenMoved = null;
    unlistenResized = null;
    unlistenScaleChanged = null;
  }

  function margin(): number {
    return opts.getConfig().hysteresis_margin_px ?? DEFAULTS.hysteresis_margin_px;
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
    // Nothing can click a hidden window — resumes via onVisibilityChange.
    if (doc.visibilityState === "hidden") return;
    const ms = opts.getConfig().poll_interval_ms ?? DEFAULTS.poll_interval_ms;
    pollHandle = schedule(() => {
      void poll();
    }, ms);
  }

  // Hidden window: pause the poll instead of burning IPC on a window nothing can see.
  function onVisibilityChange(): void {
    if (doc.visibilityState === "hidden") {
      stopPoll();
    } else if (running && !suspended && state === "passthrough" && pollHandle === null) {
      scheduleNextPoll();
    }
  }

  // PASSTHROUGH loop: webview is blind, so read the global cursor and convert. Only
  // cursorPosition() is read every tick; the slower statics are cached (see subscribeWindowEvents).
  async function poll(): Promise<void> {
    if (
      !running ||
      suspended ||
      state !== "passthrough" ||
      !win ||
      doc.visibilityState === "hidden"
    )
      return;
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
      if (cachedOrigin === null) return; // statics not yet established
      pollFailureCount = 0;
      const local = physicalCursorToLocalCss(cursor, cachedOrigin, cachedSf, cachedCursorSf);
      // Entering CAPTURE uses the tight box (margin 0).
      applySample(opts.isOverInteractive(local.x, local.y, 0));
    } catch (err) {
      log.warn("poll_failed", { error: String(err) });
      pollFailureCount++;
      if (pollFailureCount >= POLL_FAILURE_THRESHOLD) {
        log.warn("poll_failure_threshold_reached", { degrade: "capture" });
        pollFailureCount = 0;
        state = "capture";
        counter = 0;
        setIgnore(false);
        stopPoll();
        return;
      }
    }
    if (running && !suspended && state === "passthrough") scheduleNextPoll();
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
    suspendedOwner = null;
    pollFailureCount = 0;
    tick = 0;
    cachedOrigin = null;
    subscribeWindowEvents(win);
    moveTarget.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("visibilitychange", onVisibilityChange);
  }

  function stop(): void {
    running = false;
    stopPoll();
    unsubscribeWindowEvents();
    moveTarget.removeEventListener("pointermove", onPointerMove);
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    // Leave the window interactive so teardown never strands click-through on.
    setIgnore(false);
    win = null;
  }

  function suspend(mode: "capture" | "passthrough" = "capture", owner = "default"): void {
    suspended = true;
    suspendedOwner = owner;
    state = "capture";
    counter = 0;
    pollFailureCount = 0;
    stopPoll();
    setIgnore(mode === "passthrough");
  }

  function resume(owner = "default"): void {
    if (suspendedOwner !== owner) return;
    suspended = false;
    suspendedOwner = null;
    state = "capture";
    counter = 0;
    pollFailureCount = 0;
    setIgnore(false);
  }

  return { start, stop, suspend, resume };
}
