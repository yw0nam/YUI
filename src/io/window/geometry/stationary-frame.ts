/**
 * stationary-frame — widens the real window around a character that stays where she is.
 *
 * A scene wider than the window parks the real window once with padding on either side
 * and draws the reference-size framing at the left padding inside it
 * (`Renderer.setViewWindow`), so the bottom edge and the character's place on screen do
 * not move. A release reads the live origin, so a drag of the parked window is kept.
 */

import type { Renderer } from "../../../renderer";
import type { FrameWindow } from "./travel-frame";

/** Extents either side of the character's canvas x, in logical px. */
export interface FrameExtents {
  leftPx: number;
  rightPx: number;
  anchorX: number;
}

/** The padding each side needs for the extents to fit a view `viewWidth` wide. */
export function framePadding(e: FrameExtents, viewWidth: number): { left: number; right: number } {
  return {
    left: Math.ceil(Math.max(0, e.leftPx - e.anchorX)),
    right: Math.ceil(Math.max(0, e.anchorX + e.rightPx - viewWidth)),
  };
}

/** Above this logical-px difference the live window no longer has the parked size. */
const SIZE_DRIFT_PX = 1;

export function createStationaryFrame(deps: {
  frame: FrameWindow;
  renderer: Pick<Renderer, "setViewWindow">;
  setKeepOnScreenPaused(paused: boolean): void;
}): {
  /** Widen the real window by the padding the extents need and offset the view by the left one. */
  park(e: FrameExtents): Promise<void>;
  /** After a native drag: restore the parked size if the move changed it, and the view offset. */
  refit(): Promise<void>;
  /** Back to the normal-size window where the parked one is now. Idempotent. */
  release(): Promise<void>;
  isParked(): boolean;
} {
  let parked: { left: number; width: number; height: number; parkedWidth: number } | null = null;
  /** The last park() call — `release()` awaits it so a park in flight is unparked too. */
  let parking: Promise<void> | null = null;
  let releasing: Promise<void> | null = null;

  async function liveRect(): Promise<{ x: number; y: number; width: number; height: number }> {
    const [pos, size, sf] = await Promise.all([
      deps.frame.outerPosition(),
      deps.frame.outerSize(),
      deps.frame.scaleFactor(),
    ]);
    const scale = sf > 0 ? sf : 1;
    return {
      x: pos.x / scale,
      y: pos.y / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
  }

  function applyView(p: NonNullable<typeof parked>): void {
    deps.renderer.setViewWindow({ x: p.left, y: 0, width: p.width, height: p.height });
  }

  return {
    park(e) {
      const pending = releasing;
      releasing = null;
      parking = (async () => {
        await pending?.catch(() => {});
        const live = await liveRect();
        const { left, right } = framePadding(e, live.width);
        const parkedWidth = live.width + left + right;
        deps.setKeepOnScreenPaused(true);
        try {
          await deps.frame.setFrameLogical(live.x - left, live.y, parkedWidth, live.height);
        } catch (err) {
          deps.setKeepOnScreenPaused(false);
          throw err;
        }
        parked = { left, width: live.width, height: live.height, parkedWidth };
        // Applied after the frame call resolves, as a travel does.
        applyView(parked);
      })();
      return parking;
    },
    async refit() {
      const p = parked;
      if (!p) return;
      const live = await liveRect();
      if (parked !== p) return;
      if (
        Math.abs(live.width - p.parkedWidth) > SIZE_DRIFT_PX ||
        Math.abs(live.height - p.height) > SIZE_DRIFT_PX
      ) {
        await deps.frame.setFrameLogical(live.x, live.y, p.parkedWidth, p.height);
        if (parked !== p) return;
      }
      applyView(p);
    },
    release() {
      releasing ??= (async () => {
        await parking?.catch(() => {});
        const p = parked;
        if (!p) return;
        try {
          const live = await liveRect();
          await deps.frame.setFrameLogical(live.x + p.left, live.y, p.width, p.height);
        } finally {
          parked = null;
          deps.renderer.setViewWindow(null);
          deps.setKeepOnScreenPaused(false);
        }
      })();
      return releasing;
    },
    isParked: () => parked !== null,
  };
}
