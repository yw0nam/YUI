/**
 * Drag + multi-monitor / DPI glue — F2 §drag+multimonitor (Issue #9, M1).
 *
 * # What this module does
 * - `initDrag(el)` — attaches a `pointerdown` listener to the given EventTarget
 *   (typically `.yui-stage`). On primary left-button press:
 *     1. Invokes the Rust `drag_window` command via Tauri IPC — the OS takes
 *        over and moves the window natively, no JS position tracking needed.
 *     2. Fires a `__yui_gesture_stub` CustomEvent on the element — this is the
 *        seam for the dispatcher (#21) to hook gesture events without modifying
 *        drag logic. The dispatcher does NOT exist yet; do not wire it here.
 *   Installs an `onScaleChanged` listener that logs DPI changes when the window
 *   moves across monitors.  This is a no-op in M1 but keeps the seam open for
 *   re-centering / UI adjustment at a higher DPI.
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
 * The `onScaleChanged` listener below is where we would re-center or snap if
 * needed; for now it is intentionally a logged no-op.
 *
 * # Deferred (Issue #21)
 * The `__yui_gesture_stub` event is the hook point for the dispatcher to consume
 * click/pet-gesture events. Do NOT implement dispatcher wiring here.
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
  // runtime. In a plain browser (Vite dev — the AI screenshot-verification surface,
  // PRD G7) there is no window IPC, and getCurrentWindow() throws. Skip gracefully
  // so bootstrap (renderer + dispatcher) still runs. Drag is a no-op in the browser.
  if (!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    console.debug("[YUI/drag] non-Tauri environment — drag disabled (no-op).");
    return () => {};
  }

  const win = getCurrentWindow();

  // ── scale-change listener (DPI seam for M2+) ──────────────────────────────
  // When the window moves to a display with a different scale factor, Tauri
  // emits this event. M1: log only. M2+: hook here for re-centering / UI
  // density adjustments.
  const unlistenScale = await win.onScaleChanged(({ payload }) => {
    console.debug(
      `[YUI/drag] scale changed → ${payload.scaleFactor} (size ${payload.size.width}×${payload.size.height})`,
    );
    // TODO(M2+): notify layout system of DPI change if needed.
  });

  // ── pointerdown handler ────────────────────────────────────────────────────
  function onPointerDown(e: Event): void {
    // Only act on primary (left) button; secondary / middle / pen barrel ignore.
    const buttons = (e as PointerEvent).buttons ?? 0;
    if (buttons !== 1) return;

    // ── Dispatcher seam — TODO(#21): dispatcher wiring goes here ─────────────
    // The dispatcher module does not exist yet. We fire a stub event so that
    // issue #21 can hook into gesture detection without modifying drag logic.
    el.dispatchEvent(new CustomEvent("__yui_gesture_stub", { bubbles: false }));

    // ── OS-native drag ────────────────────────────────────────────────────────
    invokeDragWindow().catch((err: unknown) => {
      console.warn("[YUI/drag] drag_window invoke failed:", err);
    });
  }

  el.addEventListener("pointerdown", onPointerDown);

  return function cleanup(): void {
    el.removeEventListener("pointerdown", onPointerDown);
    unlistenScale();
  };
}
