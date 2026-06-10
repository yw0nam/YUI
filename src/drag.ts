/**
 * Drag + multi-monitor / DPI glue.
 *
 * # What this module does
 * - `initDrag(el)` — attaches a `pointerdown` listener to the given EventTarget
 *   (typically `.yui-stage`). On primary left-button press:
 *     1. Invokes the Rust `drag_window` command via Tauri IPC — the OS takes
 *        over and moves the window natively, no JS position tracking needed.
 *     2. Fires a `__yui_gesture_stub` CustomEvent on the element — the gesture
 *        seam for the dispatcher to hook without modifying drag logic.
 *   Installs an `onScaleChanged` listener that logs DPI changes when the window
 *   moves across monitors, keeping the seam open for re-centering / UI
 *   adjustment at a higher DPI.
 *   Returns a cleanup function that removes all listeners.
 *
 * - `invokeDragWindow()` / `invokeGetMonitorsInfo()` — thin Tauri IPC wrappers,
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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createLogger } from "./logger";

const log = createLogger("drag");

// ─── IPC types ────────────────────────────────────────────────────────────────

/**
 * Monitor descriptor returned by the `get_monitors_info` Rust command.
 * Mirrors `src-tauri/src/drag.rs` `MonitorInfo` (serde camelCase).
 */
export interface MonitorInfo {
  name: string | null;
  /** Physical width in pixels. */
  widthPx: number;
  /** Physical height in pixels. */
  heightPx: number;
  /** Physical X offset of top-left corner. */
  xPx: number;
  /** Physical Y offset of top-left corner. */
  yPx: number;
  /**
   * Scale factor mapping physical → logical pixels.
   * `logical = physical / scaleFactor`.
   * 1.0 = 100% DPI, 2.0 = 200% (Retina), 1.5 = 150% (Windows HiDPI).
   */
  scaleFactor: number;
}

// ─── IPC wrappers ─────────────────────────────────────────────────────────────

/**
 * Invoke the Rust `drag_window` command to start an OS-native window drag.
 * Should be called from a primary-button `pointerdown` handler.
 */
export async function invokeDragWindow(): Promise<void> {
  return invoke("drag_window");
}

/**
 * Invoke the Rust `get_monitors_info` command.
 * Returns physical pixel sizes + scale factors for all available monitors.
 * Informational only for the drag path — the OS handles DPI-correct placement.
 */
export async function invokeGetMonitorsInfo(): Promise<MonitorInfo[]> {
  return invoke("get_monitors_info");
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

// ─── initDrag ─────────────────────────────────────────────────────────────────

/**
 * Attach OS-native drag to `el`.
 *
 * @param el - The drag surface element (typically `.yui-stage`).
 * @returns A cleanup function. Call it when the surface is torn down.
 */
export async function initDrag(el: EventTarget): Promise<() => void> {
  // Tauri-only: getCurrentWindow() / onScaleChanged / invoke() require the Tauri
  // runtime. In a plain browser (Vite dev — the AI screenshot-verification surface)
  // there is no window IPC, and getCurrentWindow() throws. Skip gracefully
  // so bootstrap (renderer + dispatcher) still runs. Drag is a no-op in the browser.
  if (!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    log.debug("non-Tauri environment — drag disabled (no-op).");
    return () => {};
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

  // ── pointerdown handler ────────────────────────────────────────────────────
  function onPointerDown(e: Event): void {
    // Only act on primary (left) button; secondary / middle / pen barrel ignore.
    const buttons = (e as PointerEvent).buttons ?? 0;
    if (buttons !== 1) return;

    // ── Dispatcher seam ──────────────────────────────────────────────────────
    // Fire a stub event so the dispatcher can hook gesture detection without
    // modifying drag logic.
    el.dispatchEvent(new CustomEvent("__yui_gesture_stub", { bubbles: false }));

    // ── OS-native drag ────────────────────────────────────────────────────────
    invokeDragWindow().catch((err: unknown) => {
      log.warn("drag_window invoke failed:", err);
    });
  }

  el.addEventListener("pointerdown", onPointerDown);

  return function cleanup(): void {
    el.removeEventListener("pointerdown", onPointerDown);
    unlistenScale();
  };
}
