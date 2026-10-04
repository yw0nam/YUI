/**
 * Threshold-gated OS-native window drag.
 *
 * # Multi-monitor / DPI correctness
 * `window.startDragging()` (JS) / `Window::start_dragging()` (Rust) is OS-
 * native. The OS DWM / Quartz Compositor handles physical↔logical remapping as
 * the window crosses monitor boundaries — we do NOT need to reposition manually
 * after a drag.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createLogger } from "../../../../logger";
import type { OrbitDelta } from "../../../../settings/avatar/camera-gestures";
import { isTauri } from "../../../../tauri-env";
import { exceedsPressTravel } from "../../../stage/press-travel";
import { attachClickGesture, type PatGesture } from "./click-gesture";
import { attachOrbitGesture } from "./orbit-gesture";

const log = createLogger("drag");

/**
 * Invoke the Rust `drag_window` command to start an OS-native window drag.
 * Should be called from a primary-button `pointerdown` handler.
 */
export async function invokeDragWindow(): Promise<void> {
  return invoke("drag_window");
}

/**
 * Attach OS-native drag to `el`, gated by a move threshold.
 *
 * @param el - The drag surface element (typically `.yui-stage`).
 * @param opts.onDragStart - Fired once per gesture when the pointer crosses
 *   `PRESS_TRAVEL_PX`. The OS-native drag waits for its return value to resolve
 *   (or starts right away for a synchronous callback), so a caller that shrinks a
 *   parked window can do so before the native drag grabs it. A rejection is logged
 *   and does not block the native drag.
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
 * @param opts.pat - Press-and-hold branch: a press on the pat point held past
 *   `holdMs` fires `onStart`, suppresses the window drag for the rest of the press,
 *   and fires `onEnd` on release — or `onAbort` when teardown ends it instead.
 *   Absent = no pat gesture.
 * @returns A cleanup function. Call it when the surface is torn down.
 */
export async function initDrag(
  el: EventTarget,
  opts: {
    onDragStart?: () => void | Promise<void>;
    onDragEnd?: () => void;
    onClick?: (pos: { x: number; y: number }) => void;
    onOrbit?: (delta: OrbitDelta) => void;
    onOrbitStart?: () => void;
    onOrbitEnd?: () => void;
    pat?: PatGesture;
  } = {},
): Promise<() => void> {
  // Orbit (Shift+left) is pure JS — attach it before the Tauri gate so it works in the
  // browser screenshot-verification surface as well as the packaged pet window.
  const detachOrbit = attachOrbitGesture(el, opts.onOrbit, opts.onOrbitStart, opts.onOrbitEnd);
  const clickGesture = attachClickGesture(el, opts.onClick, opts.pat);

  // Tauri-only: invoke() and listen() require the Tauri runtime. In a plain browser
  // (Vite dev — the AI screenshot-verification surface) there is no window IPC.
  // Skip gracefully so bootstrap (renderer + dispatcher) still runs. Window-move is a no-op
  // in the browser.
  if (!isTauri()) {
    log.debug("drag_disabled", { reason: "non_tauri" });
    return () => {
      clickGesture.dispose();
      detachOrbit();
    };
  }

  // ── threshold gesture detector ─────────────────────────────────────────────
  // A primary press arms; a move past PRESS_TRAVEL_PX promotes it to a drag,
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
    if (started || clickGesture.isPatting()) return;
    const pe = e as PointerEvent;
    if (pe.pointerId !== activePointerId) return;
    if (!exceedsPressTravel({ x: startX, y: startY }, { x: pe.clientX, y: pe.clientY })) return;
    started = true;
    el.removeEventListener("pointermove", onPointerMove);
    void startNativeDrag();
  }

  async function startNativeDrag(): Promise<void> {
    try {
      await opts.onDragStart?.();
    } catch (err: unknown) {
      log.warn("drag_start_failed", { error: String(err) });
    }
    // The button can come up (or the gesture cancel) while onDragStart is still pending;
    // `endGesture` already fired in that case, and starting the native drag now would
    // grab a button that is no longer held.
    if (ended) return;
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
    unlistenDrop();
  };
}
