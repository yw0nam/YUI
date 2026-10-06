/**
 * visible-viewport — how much of the pet window sits above its monitor's work-area bottom.
 *
 * The window hangs below the floor line while the character stands on it, so a panel
 * clamped to the webview alone reaches past the screen. The cached number is in logical px.
 */

import { createLogger } from "../../../logger";
import { floorPx, monitorAt, type PetWindow, type ScreenMonitor } from "./screen-geometry";

const log = createLogger("visible-viewport");

/** The window reads one refresh takes. */
export type VisibleViewportWindow = Pick<PetWindow, "outerPosition" | "outerSize" | "scaleFactor">;

/** Height of the window part above `workAreaBottom`, all in logical px, floored at 0. */
export function visibleViewportHeightPx(
  window: { y: number; height: number },
  workAreaBottom: number,
): number {
  return Math.max(0, Math.min(window.height, workAreaBottom - window.y));
}

export function createVisibleViewport(
  win: VisibleViewportWindow,
  monitors: () => Promise<ScreenMonitor[]>,
): { get(): number; refresh(): Promise<void> } {
  let height = Number.POSITIVE_INFINITY;

  async function refresh(): Promise<void> {
    try {
      const [pos, size, sf, list] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor(),
        monitors(),
      ]);
      const monitor = monitorAt(list, pos.x, pos.y);
      // A top-left off every monitor leaves the webview height as the only bound.
      height = monitor
        ? visibleViewportHeightPx({ y: pos.y / sf, height: size.height / sf }, floorPx(monitor))
        : Number.POSITIVE_INFINITY;
    } catch (err) {
      log.debug("visible_viewport_refresh_failed", { error: String(err) });
    }
  }

  return {
    get: () => height,
    refresh,
  };
}
