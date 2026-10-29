/** Where the Threads window sits, in screen logical px: beside the main pet window on its roomier side. */

import type { ScreenRect } from "../../../contract";
import { roomierSide } from "./quick-card-position";
import { clampToWorkArea } from "./screen-geometry";

const MAX_WIDTH_PX = 960;
const MAX_HEIGHT_PX = 820;
/** The gap to the pet window and the inset from the work area's edges. */
const GAP_PX = 12;

/** The window's rect beside `pet`, sized to fit the work area and clamped 12px inside it. */
export function threadsWindowRect({
  pet,
  workArea,
}: {
  pet: ScreenRect;
  workArea: ScreenRect;
}): ScreenRect {
  const width = Math.min(MAX_WIDTH_PX, workArea.width - 2 * GAP_PX);
  const height = Math.min(MAX_HEIGHT_PX, workArea.height - 2 * GAP_PX);
  const side = roomierSide({ left: pet.x, right: pet.x + pet.width }, workArea);
  const x = side === "right" ? pet.x + pet.width + GAP_PX : pet.x - GAP_PX - width;
  const at = clampToWorkArea(
    x,
    pet.y,
    width,
    height,
    workArea.x + GAP_PX,
    workArea.y + GAP_PX,
    workArea.width - 2 * GAP_PX,
    workArea.height - 2 * GAP_PX,
  );
  return { ...at, width, height };
}

/** The chip's screen rect moved into the window's own bounds, in window-local px: where the grow starts. */
export function chipInWindow(chip: ScreenRect, window: ScreenRect): ScreenRect {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  return {
    x: clamp(chip.x - window.x, window.width - chip.width),
    y: clamp(chip.y - window.y, window.height - chip.height),
    width: chip.width,
    height: chip.height,
  };
}
