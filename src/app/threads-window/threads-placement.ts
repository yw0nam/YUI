/**
 * The Threads window's frame: it opens beside main's pet window the first time and at its stored
 * frame after that, moves by its head's native drag, and saves the frame once a user move settles.
 */

import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import type { ScreenRect } from "../../contract";
import { type ScreenMonitor, toScreenMonitor } from "../../io/window/geometry/screen-geometry";
import {
  chipInWindow,
  nearestWorkArea,
  restoreThreadsBox,
  THREADS_PANEL_INSET_PX,
  threadsWindowRect,
} from "../../io/window/geometry/threads-position";
import { invokeDragWindow } from "../../io/window/pet/gesture/window-drag";
import { createLogger } from "../../logger";
import type { ThreadsWindowSettingsStore } from "../../settings/threads/threads-window-settings";
import { isTauri } from "../../tauri-env";

const log = createLogger("threads-placement");

/** A move is saved this long after the window's last moved event. */
const MOVE_SETTLE_MS = 300;
/** The window's own moves land within a logical px of the box it set. */
const OWN_MOVE_TOLERANCE_PX = 1;

async function readMonitors(): Promise<ScreenMonitor[]> {
  const [list, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
  return (list.length ? list : primary ? [primary] : []).map(toScreenMonitor);
}

/** The box beside main's pet window, for the first open. */
async function besidePet(panel: { width: number; height: number }): Promise<ScreenRect> {
  const owner = await WebviewWindow.getByLabel("main");
  if (!owner) throw new Error("main window not found");
  const [position, size, scale] = await Promise.all([
    owner.outerPosition(),
    owner.outerSize(),
    owner.scaleFactor(),
  ]);
  const pet = {
    x: position.x / scale,
    y: position.y / scale,
    width: size.width / scale,
    height: size.height / scale,
  };
  const centre = { x: pet.x + pet.width / 2, y: pet.y + pet.height / 2 };
  const workArea = nearestWorkArea(centre, await readMonitors());
  if (!workArea) throw new Error("no monitor");
  return threadsWindowRect({ pet, workArea, panel });
}

export function createThreadsPlacement(deps: {
  settings: Pick<ThreadsWindowSettingsStore, "get" | "setFrame">;
}) {
  // The box as last placed, applied or saved, in logical px.
  let box: ScreenRect | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;

  async function apply(next: ScreenRect): Promise<void> {
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(next.width, next.height));
    await win.setPosition(new LogicalPosition(next.x, next.y));
    box = next;
  }

  function save(): void {
    if (!box) return;
    deps.settings.setFrame({
      x: box.x + THREADS_PANEL_INSET_PX,
      y: box.y + THREADS_PANEL_INSET_PX,
      width: box.width - 2 * THREADS_PANEL_INSET_PX,
      height: box.height - 2 * THREADS_PANEL_INSET_PX,
    });
  }

  /** The window's box where it is now, read at its current scale; null before its first placement. */
  async function readBox(): Promise<ScreenRect | null> {
    if (!box) return null;
    const win = getCurrentWindow();
    const [position, size, scale] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
    ]);
    return {
      x: position.x / scale,
      y: position.y / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
  }

  async function saveMove(): Promise<void> {
    settle = null;
    const moved = await readBox();
    if (!moved || !box) return;
    const own =
      Math.abs(moved.x - box.x) <= OWN_MOVE_TOLERANCE_PX &&
      Math.abs(moved.y - box.y) <= OWN_MOVE_TOLERANCE_PX;
    if (own) return;
    box = moved;
    save();
  }

  let offMoved: (() => void) | null = null;
  let disposed = false;
  if (isTauri()) {
    getCurrentWindow()
      .onMoved(() => {
        if (settle) clearTimeout(settle);
        settle = setTimeout(() => {
          saveMove().catch((error) =>
            log.warn("threads_move_save_failed", { error: String(error) }),
          );
        }, MOVE_SETTLE_MS);
      })
      .then((off) => {
        if (disposed) off();
        else offMoved = off;
      })
      .catch((error) => log.warn("threads_move_listen_failed", { error: String(error) }));
  }

  return {
    /** Places, shows and focuses the window for a chip at `chip`; resolves where the grow starts, in window-local px. */
    async open(chip: ScreenRect): Promise<ScreenRect> {
      const { x, y, width, height } = deps.settings.get();
      const next =
        x !== undefined && y !== undefined
          ? restoreThreadsBox({ x, y, width, height }, await readMonitors())
          : await besidePet({ width, height });
      await apply(next);
      save();
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
      return chipInWindow(chip, next);
    },
    /** Brings the shown window to the front where it is. */
    async focus(): Promise<void> {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
    },
    /** Saves a move still settling, then hides the window. */
    async hide(): Promise<void> {
      if (settle) {
        clearTimeout(settle);
        await saveMove();
      }
      await getCurrentWindow().hide();
    },
    /** Starts the native drag; called from the head's pointerdown, while the button is held. */
    startDrag(): void {
      if (!isTauri()) return;
      invokeDragWindow().catch((error) =>
        log.warn("threads_drag_failed", { error: String(error) }),
      );
    },
    /** The window's box where it is now, and the work area of the monitor it is on. */
    async current(): Promise<{ box: ScreenRect; workArea: ScreenRect } | null> {
      const now = await readBox();
      if (!now) return null;
      const centre = { x: now.x + now.width / 2, y: now.y + now.height / 2 };
      const workArea = nearestWorkArea(centre, await readMonitors());
      return workArea ? { box: now, workArea } : null;
    },
    /** Sets the window's box; its own move is not saved as a user move. */
    apply,
    /** Saves the window's box as the stored frame. */
    save,
    /** Stops listening to moves and drops a move still settling. */
    dispose(): void {
      disposed = true;
      offMoved?.();
      if (settle) clearTimeout(settle);
      settle = null;
    },
  };
}
