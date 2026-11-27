/** Where the Character menu window goes for her: her window and work area in global logical px, her head and chest in her window's px. */

import type { CharacterMenu } from "../../io/bridge/settings-bridge";
import { logicalWorkArea, monitorAtLogical } from "../../io/window/geometry/screen-geometry";
import type { Renderer } from "../../renderer";
import type { wireLocomotion } from "../stage/wire-locomotion";

export type MenuPlacementRead = Pick<
  Extract<CharacterMenu, { type: "open" }>,
  "frame" | "workArea" | "head" | "nameTop" | "chest"
>;

export async function readMenuPlacement(deps: {
  renderer: Pick<Renderer, "getTapPoints" | "getSilhouetteBounds">;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "frame">;
}): Promise<MenuPlacementRead> {
  const win = deps.locomotion.frame.frameWindow();
  const [pos, size, scale, monitors] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.scaleFactor(),
    deps.locomotion.frame.listMonitors(),
  ]);
  const frame = {
    x: pos.x / scale,
    y: pos.y / scale,
    width: size.width / scale,
    height: size.height / scale,
  };
  const monitor = monitorAtLogical(monitors, frame.x + frame.width / 2, frame.y + frame.height / 2);
  if (!monitor) throw new Error("no monitor under her window");
  const tap = deps.renderer.getTapPoints();
  const silhouette = deps.renderer.getSilhouetteBounds();
  return {
    frame,
    workArea: logicalWorkArea(monitor),
    head: tap?.head?.y ?? frame.height * 0.4,
    nameTop: silhouette?.top ?? frame.height * 0.25,
    chest: tap?.chest ?? { x: frame.width / 2, y: frame.height / 2 },
  };
}
