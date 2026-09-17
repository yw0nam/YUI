/**
 * anchor — pure mapping from the character's on-screen feet to the chat
 * input's bottom offset. Keeps the input just below the feet and clamped on
 * screen as the camera reframes (resize / wheel-zoom).
 */

/** Gap between the feet and the top of the input (px). */
export const INPUT_FEET_GAP_PX = 12;
/** Min movement before re-writing the var — skips sub-pixel churn each frame. */
export const INPUT_ANCHOR_EPSILON_PX = 0.5;
/** Min distance the input keeps from either viewport edge (px). */
export const INPUT_ANCHOR_MIN_BOTTOM_PX = 8;

/**
 * feetY (px from top) + canvasH → input bottom offset (px from bottom),
 * gapped below the feet and clamped to [minBottom, canvasH - minBottom].
 */
export function inputBottomFromAnchor(
  feetY: number,
  canvasH: number,
  opts: { gap: number; minBottom: number },
): number {
  const raw = canvasH - feetY - opts.gap;
  return Math.min(canvasH - opts.minBottom, Math.max(opts.minBottom, raw));
}
