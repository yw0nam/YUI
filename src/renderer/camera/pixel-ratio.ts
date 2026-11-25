/**
 * pixel-ratio — the devicePixelRatio clamp, and a watch on the ratio's changes.
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

/** Calls `onChange` with each new devicePixelRatio, as when her window moves to another monitor; returns the stop. */
export function watchPixelRatio(onChange: (ratio: number) => void): () => void {
  let query: MediaQueryList;
  const changed = (): void => {
    query.removeEventListener("change", changed);
    onChange(devicePixelRatio);
    arm();
  };
  const arm = (): void => {
    query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    query.addEventListener("change", changed);
  };
  arm();
  return () => query.removeEventListener("change", changed);
}
