/**
 * Client (window-local CSS px, e.g. MouseEvent.clientX/clientY) → stage-local
 * conversion. Owned by the renderer, which caches the mount's own
 * getBoundingClientRect() alongside its existing ResizeObserver — callers pass
 * client coordinates straight through instead of tracking their own rect.
 */

/** Viewport-relative rect corner needed for the conversion (DOMRect-compatible). */
export interface RectOrigin {
  readonly left: number;
  readonly top: number;
}

/** Convert a window-local client-px point into coordinates relative to rect's top-left. */
export function clientToStage(
  xClient: number,
  yClient: number,
  rect: RectOrigin,
): { x: number; y: number } {
  return { x: xClient - rect.left, y: yClient - rect.top };
}
