/** Feeds the stage's pointer events into the touch gesture recognizer. */
import type { TouchGesture } from "./touch-gesture";

type TouchSurface = EventTarget &
  Partial<Pick<Element, "setPointerCapture" | "releasePointerCapture">>;

/** Feeds the stage's pointer events into the gesture; returns the detach. */
export function attachStageTouch(el: TouchSurface, gesture: TouchGesture): () => void {
  function onDown(e: Event): void {
    const pe = e as PointerEvent;
    if (pe.button !== 0) return;
    try {
      el.setPointerCapture?.(pe.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the gesture still sees it.
    }
    gesture.down(pe.pointerId, { x: pe.clientX, y: pe.clientY }, pe.timeStamp);
  }

  function onMove(e: Event): void {
    const pe = e as PointerEvent;
    gesture.move(pe.pointerId, { x: pe.clientX, y: pe.clientY });
  }

  function onUp(e: Event): void {
    const pe = e as PointerEvent;
    gesture.up(pe.pointerId, { x: pe.clientX, y: pe.clientY }, pe.timeStamp);
    try {
      el.releasePointerCapture?.(pe.pointerId);
    } catch {
      // The capture already ended with the pointer.
    }
  }

  function onCancel(e: Event): void {
    gesture.cancel((e as PointerEvent).pointerId);
  }

  const listeners: [string, (e: Event) => void][] = [
    ["pointerdown", onDown],
    ["pointermove", onMove],
    ["pointerup", onUp],
    ["pointercancel", onCancel],
    ["lostpointercapture", onCancel],
  ];
  for (const [type, fn] of listeners) el.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of listeners) el.removeEventListener(type, fn);
    gesture.reset();
  };
}
