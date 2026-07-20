/**
 * Drag + multi-monitor / DPI glue.
 *
 * # What this module does
 * - `initDrag(el, opts)` — attaches a threshold gesture detector to the given
 *   EventTarget (typically `.yui-stage`). On primary left-button press it records
 *   the start point and waits: only once a `pointermove` crosses
 *   `DRAG_THRESHOLD_PX` does it fire `opts.onDragStart` (once) and invoke the Rust
 *   `drag_window` command via Tauri IPC — the OS then owns the pointer and moves
 *   the window natively. A sub-threshold press-release fires `opts.onClick`.
 *   Installs an `onScaleChanged` listener that logs DPI changes when the window
 *   moves across monitors, keeping the seam open for re-centering / UI
 *   adjustment at a higher DPI.
 *   Returns a cleanup function that removes all listeners.
 *
 * - `invokeDragWindow()` — thin Tauri IPC wrapper,
 *   exported separately so callers can be tested with a mocked `invoke`.
 *
 * - `physicalToLogical` / `logicalToPhysical` / `clampToWorkArea` — pure TS
 *   mirror of the Rust DPI math in src-tauri/src/drag.rs. Same semantics,
 *   same test cases.
 *
 * # Multi-monitor / DPI correctness
 * `window.startDragging()` (JS) / `Window::start_dragging()` (Rust) is OS-
 * native. The OS DWM / Quartz Compositor handles physical↔logical remapping as
 * the window crosses monitor boundaries — we do NOT need to reposition manually
 * after a drag.
 *
 * The `onScaleChanged` listener below is where re-centering or snapping would
 * hook; it is a logged no-op.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./io/tauri-env";
import { createLogger } from "./logger";

const log = createLogger("drag");

/**
 * Pointer travel (CSS/logical px) past which a primary press becomes a drag
 * gesture rather than a click. Below this, a press-release is a click.
 */
const DRAG_THRESHOLD_PX = 4;

// ─── IPC wrappers ─────────────────────────────────────────────────────────────

/**
 * Invoke the Rust `drag_window` command to start an OS-native window drag.
 * Should be called from a primary-button `pointerdown` handler.
 */
export async function invokeDragWindow(): Promise<void> {
  return invoke("drag_window");
}

// ─── Pure DPI math helpers ────────────────────────────────────────────────────
// Mirror of src-tauri/src/drag.rs pure helpers. Keep in sync.

/**
 * Convert a physical-pixel coordinate to a logical pixel coordinate.
 * Returns `null` if `scaleFactor` ≤ 0.
 */
export function physicalToLogical(physical: number, scaleFactor: number): number | null {
  if (scaleFactor <= 0) return null;
  return physical / scaleFactor;
}

/**
 * Convert a logical-pixel coordinate to a physical pixel coordinate (rounded).
 * Returns `null` if `scaleFactor` ≤ 0.
 */
export function logicalToPhysical(logical: number, scaleFactor: number): number | null {
  if (scaleFactor <= 0) return null;
  return Math.round(logical * scaleFactor);
}

/**
 * Clamp logical position `(x, y)` so that a window of size `(w × h)` stays
 * within the monitor's logical work area `(workX, workY, workW, workH)`.
 * All arguments in logical pixels. Returns the clamped `{ x, y }`.
 */
export function clampToWorkArea(
  x: number,
  y: number,
  w: number,
  h: number,
  workX: number,
  workY: number,
  workW: number,
  workH: number,
): { x: number; y: number } {
  return {
    x: Math.max(workX, Math.min(x, workX + workW - w)),
    y: Math.max(workY, Math.min(y, workY + workH - h)),
  };
}

// ─── orbit gesture ──────────────────────────────────────────────────────────

/** Per-move pointer delta (CSS px) fed to the camera-orbit callback. */
export interface OrbitDelta {
  dx: number;
  dy: number;
}

/**
 * Attach the Shift + left-drag orbit gesture to `el`. Pure JS (no Tauri IPC),
 * so it runs in the browser too. The modifier branch fully consumes the gesture:
 * preventDefault + pointer capture, so it never leaks into the window-move path or
 * the alpha hit-test click-through. Feeds per-move deltas to `onOrbit`. Returns a
 * detach function. No-op (returns a no-op) when `onOrbit` is absent.
 */
function attachOrbitGesture(
  el: EventTarget,
  onOrbit?: (d: OrbitDelta) => void,
  onOrbitStart?: () => void,
  onOrbitEnd?: () => void,
): () => void {
  if (!onOrbit && !onOrbitStart && !onOrbitEnd) return () => {};
  let orbiting = false;
  let lastX = 0;
  let lastY = 0;
  let pointerId = -1;

  function detachMove(): void {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onEnd);
    el.removeEventListener("pointercancel", onEnd);
  }

  function onDown(e: Event): void {
    const pe = e as PointerEvent;
    // Shift + primary (left) only. Plain left-drag falls through to window-move.
    if (!pe.shiftKey || (pe.buttons ?? 0) !== 1) return;
    pe.preventDefault();
    orbiting = true;
    lastX = pe.clientX;
    lastY = pe.clientY;
    pointerId = pe.pointerId;
    (el as Partial<Element>).setPointerCapture?.(pointerId);
    onOrbitStart?.();
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
  }

  function onMove(e: Event): void {
    if (!orbiting) return;
    const pe = e as PointerEvent;
    pe.preventDefault();
    const dx = pe.clientX - lastX;
    const dy = pe.clientY - lastY;
    lastX = pe.clientX;
    lastY = pe.clientY;
    onOrbit?.({ dx, dy });
  }

  function onEnd(): void {
    if (!orbiting) return;
    orbiting = false;
    (el as Partial<Element>).releasePointerCapture?.(pointerId);
    detachMove();
    onOrbitEnd?.();
  }

  el.addEventListener("pointerdown", onDown);
  return function detach(): void {
    el.removeEventListener("pointerdown", onDown);
    // Balance an in-progress orbit so onOrbitEnd (hit-test resume) isn't stranded on teardown.
    if (orbiting) {
      orbiting = false;
      onOrbitEnd?.();
    }
    detachMove();
  };
}

// ─── initDrag ─────────────────────────────────────────────────────────────────

function attachClickGesture(
  el: EventTarget,
  onClick?: (pos: { x: number; y: number }) => void,
): { reset: () => void; dispose: () => void } {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let crossedThreshold = false;

  function detachGesture(): void {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onCancel);
  }

  function clearGesture(): void {
    detachGesture();
    pointerId = null;
  }

  function onDown(e: Event): void {
    const pe = e as PointerEvent;
    if ((pe.buttons ?? 0) !== 1 || pe.shiftKey) return;
    if (pointerId !== null) {
      if (pe.pointerId !== pointerId) return;
      clearGesture();
    }
    pointerId = pe.pointerId;
    startX = pe.clientX;
    startY = pe.clientY;
    crossedThreshold = false;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
  }

  function onMove(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerId !== pointerId || crossedThreshold) return;
    crossedThreshold = Math.hypot(pe.clientX - startX, pe.clientY - startY) >= DRAG_THRESHOLD_PX;
  }

  function onUp(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerId !== pointerId) return;
    if (pe.button !== undefined && pe.button !== 0) return;
    const click = !crossedThreshold;
    clearGesture();
    if (click) onClick?.({ x: pe.clientX, y: pe.clientY });
  }

  function onCancel(e: Event): void {
    if ((e as PointerEvent).pointerId !== pointerId) return;
    clearGesture();
  }

  el.addEventListener("pointerdown", onDown);
  return {
    reset: clearGesture,
    dispose: () => {
      el.removeEventListener("pointerdown", onDown);
      clearGesture();
    },
  };
}

/**
 * Attach OS-native drag to `el`, gated by a move threshold.
 *
 * @param el - The drag surface element (typically `.yui-stage`).
 * @param opts.onDragStart - Fired once per gesture when the pointer crosses
 *   `DRAG_THRESHOLD_PX`, just before the OS-native drag begins.
 * @param opts.onDragEnd - Fired once per gesture on pointerup/pointercancel
 *   after a threshold-crossing drag. Not fired for sub-threshold clicks.
 * @param opts.onClick - Fired once for a sub-threshold primary press-release,
 *   with the pointerup viewport coordinates.
 * @param opts.onOrbit - Fired per pointermove during a Shift + left-drag
 *   with the pointer delta. This branch consumes the gesture (no window-move).
 * @param opts.onOrbitStart - Fired once when a Shift + left orbit gesture
 *   commits (pointerdown with shiftKey + primary button). Use to suspend hit-test.
 * @param opts.onOrbitEnd - Fired once when the orbit gesture ends (pointerup or
 *   pointercancel). Use to resume hit-test.
 * @returns A cleanup function. Call it when the surface is torn down.
 */
export async function initDrag(
  el: EventTarget,
  opts: {
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onClick?: (pos: { x: number; y: number }) => void;
    onOrbit?: (delta: OrbitDelta) => void;
    onOrbitStart?: () => void;
    onOrbitEnd?: () => void;
  } = {},
): Promise<() => void> {
  // Orbit (Shift+left) is pure JS — attach it before the Tauri gate so it works in the
  // browser screenshot-verification surface as well as the packaged pet window.
  const detachOrbit = attachOrbitGesture(el, opts.onOrbit, opts.onOrbitStart, opts.onOrbitEnd);
  const clickGesture = attachClickGesture(el, opts.onClick);

  // Tauri-only: getCurrentWindow() / onScaleChanged / invoke() require the Tauri
  // runtime. In a plain browser (Vite dev — the AI screenshot-verification surface)
  // there is no window IPC, and getCurrentWindow() throws. Skip gracefully
  // so bootstrap (renderer + dispatcher) still runs. Window-move is a no-op in the browser.
  if (!isTauri()) {
    log.debug("drag_disabled", { reason: "non_tauri" });
    return () => {
      clickGesture.dispose();
      detachOrbit();
    };
  }

  const win = getCurrentWindow();

  // ── scale-change listener (DPI seam) ──────────────────────────────────────
  // When the window moves to a display with a different scale factor, Tauri
  // emits this event. Logs only; the seam for re-centering / UI density
  // adjustments hooks here.
  const unlistenScale = await win.onScaleChanged(({ payload }) => {
    log.debug(
      `scale changed → ${payload.scaleFactor} (size ${payload.size.width}×${payload.size.height})`,
    );
  });

  // ── threshold gesture detector ─────────────────────────────────────────────
  // A primary press arms; a move past DRAG_THRESHOLD_PX promotes it to a drag,
  // firing onDragStart + the OS-native drag once. The shared click detector
  // handles a press-release below the threshold.
  //
  // On Windows the OS modal move loop swallows the webview pointerup, so
  // onPointerEnd never fires and callers stay suspended. We subscribe to the
  // reliable window_drop_release Tauri event as a fallback drag-end signal.
  // An `ended` guard ensures onDragEnd fires exactly once per gesture regardless
  // of which path (pointerup/pointercancel or window_drop_release) arrives first.
  let startX = 0;
  let startY = 0;
  let started = false;
  let ended = false;
  let activePointerId: number | null = null;

  function detach(): void {
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
    activePointerId = null;
  }

  function endGesture(): void {
    if (!started || ended) return;
    ended = true;
    detach();
    opts.onDragEnd?.();
  }

  function onPointerMove(e: Event): void {
    if (started) return;
    const pe = e as PointerEvent;
    if (pe.pointerId !== activePointerId) return;
    const dx = pe.clientX - startX;
    const dy = pe.clientY - startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    started = true;
    el.removeEventListener("pointermove", onPointerMove);
    opts.onDragStart?.();
    invokeDragWindow().catch((err: unknown) => {
      log.warn("drag_window_invoke_failed", { error: String(err) });
    });
  }

  function onPointerUp(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerId !== activePointerId) return;
    if (pe.button !== undefined && pe.button !== 0) return;
    endGesture();
    detach();
  }

  function onPointerCancel(e: Event): void {
    if ((e as PointerEvent).pointerId !== activePointerId) return;
    endGesture();
    detach();
  }

  function onPointerDown(e: Event): void {
    // Only act on primary (left) button; secondary / middle / pen barrel ignore.
    const pe = e as PointerEvent;
    if (activePointerId !== null || (pe.buttons ?? 0) !== 1) return;
    // Shift + left is the orbit gesture (attachOrbitGesture) — not window-move.
    if (pe.shiftKey) return;
    startX = pe.clientX;
    startY = pe.clientY;
    started = false;
    ended = false;
    activePointerId = pe.pointerId;
    (el as Partial<Element>).setPointerCapture?.(pe.pointerId);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
  }

  el.addEventListener("pointerdown", onPointerDown);

  // Subscribe once to window_drop_release (reliable on Windows — the OS modal
  // move loop swallows pointerup but always fires this event on drag release).
  const unlistenDrop = await listen("window_drop_release", () => {
    endGesture();
    clickGesture.reset();
  });

  return function cleanup(): void {
    el.removeEventListener("pointerdown", onPointerDown);
    detach();
    clickGesture.dispose();
    detachOrbit();
    unlistenScale();
    unlistenDrop();
  };
}
