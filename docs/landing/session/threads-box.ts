import type { ScreenRect } from "../../../src/contract/index";
import {
  chipInWindow,
  resizeThreadsBox,
  threadsWindowRect,
} from "../../../src/io/window/geometry/threads-position";
import type { ResizeListener } from "../../../src/ui/threads/window/resize-handles";
import { K, LH, LW } from "../desk";
import { clamp } from "../shared/math";

export function createThreadsBox({
  win,
  desk,
  pet,
}: {
  win: HTMLElement;
  desk: HTMLElement;
  pet: () => Pick<ScreenRect, "x" | "y" | "width">;
}) {
  let box: ScreenRect | null = null,
    box0: ScreenRect = { x: 0, y: 0, width: 0, height: 0 },
    open = false;
  const workArea = () => ({ x: 0, y: 0, width: LW, height: LH });
  const place = () => {
    Object.assign(win.style, {
      left: `${box!.x}px`,
      top: `${box!.y}px`,
      width: `${box!.width}px`,
      height: `${box!.height}px`,
    });
  };
  const clampBox = () => {
    if (!box) return;
    box.width = Math.min(box.width, LW - 24);
    box.height = Math.min(box.height, LH - 24);
    box.x = clamp(box.x, 120 - box.width, LW - 120);
    box.y = clamp(box.y, 0, LH - 60);
  };
  const resize: ResizeListener = {
    start() {
      box0 = { ...box! };
    },
    move(edge, dx, dy) {
      box = resizeThreadsBox(box0, workArea(), edge, dx / K, dy / K);
      place();
    },
    end() {},
  };
  return {
    resize,
    isOpen: () => open,
    read: () => ({ threadsOpen: open, box: box ? { ...box } : null }),
    /** Shows the window and returns the chip's rect inside it. */
    open(chipRect: ScreenRect): ScreenRect {
      const d = desk.getBoundingClientRect();
      const chipScreen = {
        x: (chipRect.x - d.left) / K,
        y: (chipRect.y - d.top) / K,
        width: chipRect.width / K,
        height: chipRect.height / K,
      };
      box =
        box ??
        threadsWindowRect({ pet: pet(), workArea: workArea(), panel: { width: 880, height: 680 } });
      clampBox();
      place();
      win.hidden = false;
      open = true;
      return chipInWindow(chipScreen, box);
    },
    /** Marks the window closed; false when it already was. */
    close() {
      if (!open) return false;
      open = false;
      return true;
    },
    hide() {
      win.hidden = true;
    },
    drag(e: PointerEvent) {
      const start = { x: e.clientX, y: e.clientY, bx: box!.x, by: box!.y };
      const mv = (ev: PointerEvent) => {
        box!.x = clamp(start.bx + (ev.clientX - start.x) / K, 120 - box!.width, LW - 120);
        box!.y = clamp(start.by + (ev.clientY - start.y) / K, 0, LH - 60);
        place();
      };
      const up = () => {
        removeEventListener("pointermove", mv);
        removeEventListener("pointerup", up);
      };
      addEventListener("pointermove", mv);
      addEventListener("pointerup", up);
    },
    fitToWorkArea() {
      if (!box) return;
      clampBox();
      if (open) place();
    },
  };
}
