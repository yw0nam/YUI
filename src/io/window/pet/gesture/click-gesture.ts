/**
 * Sub-threshold click and press-and-hold pat gesture detectors.
 */

import { createLogger } from "../../../../logger";
import { exceedsPressTravel } from "../../../stage/press-travel";

const log = createLogger("drag");

/**
 * Press-and-hold branch of the click gesture: a primary press that lands on the pat
 * point and outlives `holdMs` becomes a pat instead of a click, and stays out of the
 * window-drag path until it is released.
 */
export interface PatGesture {
  /** Whether the press point is over the pattable region (the head). */
  isPatPoint: (pos: { x: number; y: number }) => boolean;
  /** Hold (ms) before the press becomes a pat — read at press time so config reload applies. */
  holdMs: () => number;
  onStart: () => void;
  /** Pat released — ends the reaction and lets the release cue fire. */
  onEnd: () => void;
  /** Surface torn down mid-pat — ends the reaction only, no release cue. */
  onAbort: () => void;
}

export function attachClickGesture(
  el: EventTarget,
  onClick?: (pos: { x: number; y: number }) => void,
  pat?: PatGesture,
): { reset: () => void; isPatting: () => boolean; dispose: () => void } {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let crossedThreshold = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let patting = false;

  function detachGesture(): void {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onCancel);
    el.removeEventListener("lostpointercapture", onLostCapture);
  }

  function clearHoldTimer(): void {
    if (holdTimer === null) return;
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function endGesture(released: boolean): void {
    detachGesture();
    clearHoldTimer();
    pointerId = null;
    if (!patting) return;
    patting = false;
    if (released) pat?.onEnd();
    else pat?.onAbort();
  }

  /** The press ended on its own — a pat that got this far earned its release cue. */
  function clearGesture(): void {
    endGesture(true);
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
    // Listeners first: a throw while arming the hold must not strand the gesture.
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("lostpointercapture", onLostCapture);
    armPatHold(pe);
  }

  /** A classifier or config read that fails degrades to "no pat" — never to a stranded press. */
  function armPatHold(pe: PointerEvent): void {
    const gesture = pat;
    if (!gesture) return;
    try {
      if (!gesture.isPatPoint({ x: pe.clientX, y: pe.clientY })) return;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        patting = true;
        gesture.onStart();
      }, gesture.holdMs());
    } catch (err) {
      log.warn("pat_arm_failed", { error: String(err) });
    }
  }

  function onMove(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerId !== pointerId || crossedThreshold) return;
    crossedThreshold = exceedsPressTravel(
      { x: startX, y: startY },
      { x: pe.clientX, y: pe.clientY },
    );
    // Travel before the hold elapses is a drag, not a pat.
    if (crossedThreshold) clearHoldTimer();
  }

  function onUp(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.pointerId !== pointerId) return;
    if (pe.button !== undefined && pe.button !== 0) return;
    const click = !crossedThreshold && !patting;
    clearGesture();
    if (click) onClick?.({ x: pe.clientX, y: pe.clientY });
  }

  function onCancel(e: Event): void {
    if ((e as PointerEvent).pointerId !== pointerId) return;
    clearGesture();
  }

  /**
   * Capture loss without a pointerup — the OS or the click-through hit-test took the
   * pointer away mid-press. Ends the gesture so a pat can never stay held forever.
   */
  function onLostCapture(e: Event): void {
    if ((e as PointerEvent).pointerId !== pointerId) return;
    clearGesture();
  }

  el.addEventListener("pointerdown", onDown);
  return {
    reset: clearGesture,
    isPatting: () => patting,
    dispose: () => {
      el.removeEventListener("pointerdown", onDown);
      endGesture(false);
    },
  };
}
