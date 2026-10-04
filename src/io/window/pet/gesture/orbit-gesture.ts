/**
 * Shift + left-drag orbit gesture: camera deltas instead of window-move.
 */

import type { OrbitDelta } from "../../../../settings/avatar/camera-gestures";

/**
 * Attach the Shift + left-drag orbit gesture to `el`. Pure JS (no Tauri IPC),
 * so it runs in the browser too. The modifier branch fully consumes the gesture:
 * preventDefault + pointer capture, so it never leaks into the window-move path or
 * the alpha hit-test click-through. Feeds per-move deltas to `onOrbit`. Returns a
 * detach function. No-op (returns a no-op) when `onOrbit` is absent.
 */
export function attachOrbitGesture(
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
