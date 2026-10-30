/** The Threads window on the shared window dock: docked beside main's pet window on each open, grown out of the chip. */

import type { ScreenRect } from "../../contract";
import { insetWorkArea } from "../../io/window/dock/dock-position";
import { createWindowDock } from "../../io/window/dock/window-dock";
import {
  chipInWindow,
  THREADS_GAP_PX,
  THREADS_PANEL_INSET_PX,
  threadsWindowRect,
} from "../../io/window/geometry/threads-position";

export function wireThreadsDock(deps: {
  head: { onHeadPointerDown(cb: (event: PointerEvent) => void): () => void };
}): {
  /** Places, shows, links and focuses the window for a chip at `chip` (screen logical px); resolves where the grow starts, in window-local px. */
  open(chip: ScreenRect): Promise<ScreenRect>;
  /** Unlinks the window, then hides it. */
  hide(): Promise<void>;
} {
  // The size the last placement fitted to its work area.
  let size = { width: 0, height: 0 };
  const dock = createWindowDock<ScreenRect>({
    ownerLabel: "main",
    box: () => size,
    inset: THREADS_PANEL_INSET_PX,
    gap: THREADS_GAP_PX + THREADS_PANEL_INSET_PX,
    anchor: (owner) => ({
      anchor: { left: owner.log.x, right: owner.log.x + owner.width, y: owner.log.y },
      at: { x: owner.log.x + owner.width / 2, y: owner.log.y + owner.height / 2 },
    }),
    clampBounds: (workArea) => insetWorkArea(workArea, THREADS_GAP_PX),
    beside: (pet, workArea, side) => {
      const rect = threadsWindowRect({
        pet: { x: pet.left, y: pet.y, width: pet.right - pet.left },
        workArea,
        side,
      });
      size = { width: rect.width, height: rect.height };
      return { x: rect.x, y: rect.y, side: rect.side };
    },
    fit: async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
    },
    onHeadPointerDown: deps.head.onHeadPointerDown,
  });

  return {
    async open(chip) {
      const at = await dock.dock(chip);
      return chipInWindow(chip, { x: at.x, y: at.y, ...size });
    },
    hide: dock.hide,
  };
}
