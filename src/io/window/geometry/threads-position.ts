/** Where the Threads window sits, in screen logical px: beside the main pet window on its roomier side. */

import type { ScreenRect } from "../../../contract";
import { type DockSide, roomierSide } from "../dock/dock-position";
import { clampToWorkArea, type ScreenMonitor } from "./screen-geometry";

const MAX_WIDTH_PX = 960;
const MAX_HEIGHT_PX = 820;
/** The gap from the pet window to the window's box, and the box's inset from the work area's edges. */
export const THREADS_GAP_PX = 12;
/** Transparent padding around the panel inside its window, for the shadow; the stylesheet sets the same. */
export const THREADS_PANEL_INSET_PX = 8;

/** The window's rect beside `pet` on `side` (absent, the roomier one), sized to fit the work area and clamped 12px inside it. */
export function threadsWindowRect({
  pet,
  workArea,
  side,
}: {
  pet: Pick<ScreenRect, "x" | "y" | "width">;
  workArea: ScreenRect;
  side?: DockSide;
}): ScreenRect & { side: DockSide } {
  const width = Math.min(MAX_WIDTH_PX, workArea.width - 2 * THREADS_GAP_PX);
  const height = Math.min(MAX_HEIGHT_PX, workArea.height - 2 * THREADS_GAP_PX);
  const chosen = side ?? roomierSide({ left: pet.x, right: pet.x + pet.width }, workArea);
  const x =
    chosen === "right" ? pet.x + pet.width + THREADS_GAP_PX : pet.x - THREADS_GAP_PX - width;
  const at = clampToWorkArea(
    x,
    pet.y,
    width,
    height,
    workArea.x + THREADS_GAP_PX,
    workArea.y + THREADS_GAP_PX,
    workArea.width - 2 * THREADS_GAP_PX,
    workArea.height - 2 * THREADS_GAP_PX,
  );
  return { ...at, width, height, side: chosen };
}

export function restoreThreadsBox(panel: ScreenRect, _monitors: ScreenMonitor[]): ScreenRect {
  return panel;
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
