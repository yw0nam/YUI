/**
 * Drag + multi-monitor / DPI glue.
 *
 * # What this module does
 * - `initDrag(el, opts)` — attaches a threshold gesture detector to the given
 *   EventTarget (typically `.yui-stage`). On primary left-button press it records
 *   the start point and waits: only once a `pointermove` crosses
 *   `DRAG_THRESHOLD_PX` does it fire `opts.onDragStart` (once) and invoke the Rust
 *   `drag_window` command via Tauri IPC — the OS then owns the pointer and moves
 *   the window natively. A sub-threshold press-release is a click and fires
 *   nothing.
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

/**
 * Attach OS-native drag to `el`, gated by a move threshold.
 *
 * @param el - The drag surface element (typically `.yui-stage`).
 * @param opts.onDragStart - Fired once per gesture when the pointer crosses
 *   `DRAG_THRESHOLD_PX`, just before the OS-native drag begins.
 * @param opts.onDragEnd - Fired once per gesture on pointerup/pointercancel
 *   after a threshold-crossing drag. Not fired for sub-threshold clicks.
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
    onOrbit?: (delta: OrbitDelta) => void;
    onOrbitStart?: () => void;
    onOrbitEnd?: () => void;
  } = {},
): Promise<() => void> {
  // Orbit (Shift+left) is pure JS — attach it before the Tauri gate so it works in the
  // browser screenshot-verification surface as well as the packaged pet window.
  const detachOrbit = attachOrbitGesture(el, opts.onOrbit, opts.onOrbitStart, opts.onOrbitEnd);

  // Tauri-only: getCurrentWindow() / onScaleChanged / invoke() require the Tauri
  // runtime. In a plain browser (Vite dev — the AI screenshot-verification surface)
  // there is no window IPC, and getCurrentWindow() throws. Skip gracefully
  // so bootstrap (renderer + dispatcher) still runs. Window-move is a no-op in the browser.
  if (!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    log.debug("drag_disabled", { reason: "non_tauri" });
    return () => {
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
  // firing onDragStart + the OS-native drag once. A press-release below the
  // threshold is a click and fires nothing.
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

  function detach(): void {
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerEnd);
    el.removeEventListener("pointercancel", onPointerEnd);
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

  function onPointerEnd(): void {
    endGesture();
    detach();
  }

  function onPointerDown(e: Event): void {
    // Only act on primary (left) button; secondary / middle / pen barrel ignore.
    const pe = e as PointerEvent;
    if ((pe.buttons ?? 0) !== 1) return;
    // Shift + left is the orbit gesture (attachOrbitGesture) — not window-move.
    if (pe.shiftKey) return;
    startX = pe.clientX;
    startY = pe.clientY;
    started = false;
    ended = false;
    (el as Partial<Element>).setPointerCapture?.(pe.pointerId);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
  }

  el.addEventListener("pointerdown", onPointerDown);

  // Subscribe once to window_drop_release (reliable on Windows — the OS modal
  // move loop swallows pointerup but always fires this event on drag release).
  const unlistenDrop = await listen("window_drop_release", () => {
    endGesture();
  });

  return function cleanup(): void {
    el.removeEventListener("pointerdown", onPointerDown);
    detach();
    detachOrbit();
    unlistenScale();
    unlistenDrop();
  };
}
