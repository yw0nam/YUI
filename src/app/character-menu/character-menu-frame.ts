/** The pet window around an open Character menu: held still and widened over her, her own box set on the pet root. */

import { logicalWorkArea, monitorAtLogical } from "../../io/window/geometry/screen-geometry";
import type { Travel } from "../../io/window/geometry/travel-frame";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { MenuPlacement } from "../../ui/character-menu/character-menu";
import {
  columnHeight,
  type Fold,
  type MenuWidths,
  planMenu,
  planTop,
} from "../../ui/character-menu/layout";
import type { wireLocomotion } from "../stage/wire-locomotion";

const log = createLogger("character-menu-frame");

export function createMenuFrame(deps: {
  /** The pet root: her UI lays out in the box it names in --yui-box-left, --yui-box-width and --yui-box-top. */
  root: HTMLElement;
  renderer: Pick<Renderer, "getTapPoints" | "getSilhouetteBounds">;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "hold" | "widen" | "abortTravel" | "frame">;
  focusWindow: () => Promise<void>;
  /** An agent move ended the widened window under the open menu. */
  onAbort: () => void;
}): { place(widths: MenuWidths): Promise<MenuPlacement>; restore(): Promise<void> } {
  const { root, renderer, locomotion } = deps;
  let travel: Travel | null = null;

  const heightFor = (widths: MenuWidths, fold: Fold): number =>
    columnHeight(fold === "none" ? widths.rows.none : widths.rows.folded);

  async function widen(
    widths: MenuWidths,
    head: number,
  ): Promise<{ fold: Fold; top: number } | null> {
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
    const height = size.height / scale;
    const centre = x + width / 2;
    const monitor = monitorAtLogical(monitors, centre, y + height / 2);
    if (!monitor) return null;
    const workArea = logicalWorkArea(monitor);
    const plan = planMenu({ centre, half: width / 2, workArea, widths });
    const { top, growUp } = planTop({
      head,
      height: heightFor(widths, plan.fold),
      windowBottom: height,
      workBottom: workArea.y + workArea.height - y,
    });
    const via = [
      { x: centre - plan.reachLeft, y: y - growUp },
      { x: centre + plan.reachRight - width, y: y - growUp },
    ];
    travel = await locomotion.widen(via);
    // Her UI keeps laying out in her own box inside the widened window.
    root.style.setProperty("--yui-box-left", `${x - Math.min(x, ...via.map((p) => p.x))}px`);
    root.style.setProperty("--yui-box-width", `${width}px`);
    root.style.setProperty("--yui-box-top", `${growUp}px`);
    return { fold: plan.fold, top };
  }

  async function restore(): Promise<void> {
    const ending = travel;
    travel = null;
    try {
      await ending?.end();
    } finally {
      root.style.removeProperty("--yui-box-left");
      root.style.removeProperty("--yui-box-width");
      root.style.removeProperty("--yui-box-top");
      locomotion.hold("menu", false);
    }
  }

  async function place(widths: MenuWidths): Promise<MenuPlacement> {
    locomotion.hold("menu", true, { onAbort: deps.onAbort });
    let placed: { fold: Fold; top: number } | null = null;
    try {
      // A cancelled stroll or climb may still be unparking its travel.
      await locomotion.abortTravel();
    } catch (err) {
      log.warn("abort_travel_failed", { error: String(err) });
    }
    // Read before the widen, while her box is the whole window.
    const tap = renderer.getTapPoints();
    const silhouette = renderer.getSilhouetteBounds();
    const box = { width: root.clientWidth, height: root.clientHeight };
    const head = tap?.head?.y ?? box.height * 0.4;
    try {
      placed = await widen(widths, head);
    } catch (err) {
      log.info("widen_skipped", { error: String(err) });
    }
    if (!placed) {
      // No OS window to widen: the menu opens inside the window as it is.
      const { fold } = planMenu({
        centre: box.width / 2,
        half: box.width / 2,
        workArea: { x: 0, y: 0, ...box },
        widths,
      });
      const height = heightFor(widths, fold);
      placed = {
        fold,
        top: planTop({ head, height, windowBottom: box.height, workBottom: box.height }).top,
      };
    }
    // The keyboard reaches the menu only while this window holds focus.
    void deps.focusWindow().catch((err) => log.warn("focus_failed", { error: String(err) }));
    return {
      ...placed,
      chest: tap?.chest ?? { x: box.width / 2, y: box.height / 2 },
      head: silhouette?.top ?? box.height * 0.25,
    };
  }

  return {
    async place(widths) {
      try {
        return await place(widths);
      } catch (err) {
        // A failed placement never leaves her held or the window widened.
        await restore();
        throw err;
      }
    },
    restore,
  };
}
