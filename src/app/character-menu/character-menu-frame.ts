/** The pet window around an open Character menu: held still and widened over her, her UI layer pinned to her own box. */

import { logicalWorkArea, monitorAtLogical } from "../../io/window/geometry/screen-geometry";
import type { Travel } from "../../io/window/geometry/travel-frame";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { MenuPlacement } from "../../ui/character-menu/character-menu";
import { type Fold, type MenuWidths, planMenu } from "../../ui/character-menu/layout";
import type { wireLocomotion } from "../stage/wire-locomotion";

const log = createLogger("character-menu-frame");

export function createMenuFrame(deps: {
  overlay: HTMLElement;
  renderer: Pick<Renderer, "getTapPoints" | "getSilhouetteBounds">;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "hold" | "widen" | "abortTravel" | "frame">;
  focusWindow: () => Promise<void>;
  /** An agent move ended the widened window under the open menu. */
  onAbort: () => void;
}): { place(widths: MenuWidths): Promise<MenuPlacement>; restore(): Promise<void> } {
  const { overlay, renderer, locomotion } = deps;
  let travel: Travel | null = null;

  async function widen(widths: MenuWidths): Promise<Fold | null> {
    const win = locomotion.frame.frameWindow();
    const [pos, size, scale, monitors] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
      locomotion.frame.listMonitors(),
    ]);
    const x = pos.x / scale;
    const y = pos.y / scale;
    const width = size.width / scale;
    const centre = x + width / 2;
    const monitor = monitorAtLogical(monitors, centre, y + size.height / scale / 2);
    if (!monitor) return null;
    const plan = planMenu({ centre, half: width / 2, workArea: logicalWorkArea(monitor), widths });
    const via = [
      { x: centre - plan.reachLeft, y },
      { x: centre + plan.reachRight - width, y },
    ];
    travel = await locomotion.widen(via, deps.onAbort);
    // Her UI keeps laying out in her own box inside the widened window.
    overlay.style.setProperty("left", `${x - Math.min(x, ...via.map((p) => p.x))}px`);
    overlay.style.setProperty("width", `${width}px`);
    return plan.fold;
  }

  return {
    async place(widths) {
      locomotion.hold(true);
      let fold: Fold | null = null;
      try {
        // A cancelled stroll or climb may still be unparking its travel.
        await locomotion.abortTravel();
      } catch (err) {
        log.warn("abort_travel_failed", { error: String(err) });
      }
      // Read before the widen, while her box is the whole window.
      const tap = renderer.getTapPoints();
      const silhouette = renderer.getSilhouetteBounds();
      const box = { width: overlay.clientWidth, height: overlay.clientHeight };
      try {
        fold = await widen(widths);
      } catch (err) {
        log.info("widen_skipped", { error: String(err) });
      }
      // No OS window to widen: the menu opens inside the window as it is.
      fold ??= planMenu({
        centre: box.width / 2,
        half: box.width / 2,
        workArea: { x: 0, y: 0, ...box },
        widths,
      }).fold;
      // The keyboard reaches the menu only while this window holds focus.
      void deps.focusWindow().catch((err) => log.warn("focus_failed", { error: String(err) }));
      return {
        fold,
        top: tap?.head?.y ?? box.height * 0.4,
        chest: tap?.chest ?? { x: box.width / 2, y: box.height / 2 },
        head: silhouette?.top ?? box.height * 0.25,
      };
    },
    async restore() {
      const ending = travel;
      travel = null;
      try {
        await ending?.end();
      } finally {
        overlay.style.removeProperty("left");
        overlay.style.removeProperty("width");
        locomotion.hold(false);
      }
    },
  };
}
