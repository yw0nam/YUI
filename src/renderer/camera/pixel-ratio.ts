/**
 * pixel-ratio — pure devicePixelRatio clamp (no DOM, no GL).
 *
 * WebGL framebuffers scale by devicePixelRatio², so an uncapped HiDPI ratio
 * (2–3 on many displays) inflates baseline GPU memory 4–9x for no visible
 * gain on this app's small pet window. Clamped to 2 — still crisp, bounded cost.
 */

const MAX_PIXEL_RATIO = 2;

/** Clamp a devicePixelRatio to the renderer's supported ceiling. */
export function clampPixelRatio(devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
}
