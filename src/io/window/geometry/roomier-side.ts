import type { ScreenRect } from "../../../contract";

/** The side of her with more free room in the work area; the right wins a tie. */
export function roomierSide(
  character: { left: number; right: number },
  workArea: ScreenRect,
): "left" | "right" {
  const freeLeft = character.left - workArea.x;
  const freeRight = workArea.x + workArea.width - character.right;
  return freeRight >= freeLeft ? "right" : "left";
}
