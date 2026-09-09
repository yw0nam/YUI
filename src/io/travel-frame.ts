/**
 * travel-frame — parks the real window once for a seam crossing.
 *
 * Every window move that straddles a scale boundary flashes a stale frame while AppKit
 * re-rasterizes the window at the old backing scale. A travel avoids the whole stretch of
 * per-frame moves that would cross the seam: it parks the real window once at the
 * bounding box of the path, then hands the mover a virtual window whose `setPositionLogical`
 * only redraws the reference-size framing at an offset inside that parked canvas
 * (`Renderer.setViewWindow`) — the real window never moves again until the travel ends.
 */

import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { monitorAtLogical, type PetWindow, type ScreenMonitor } from "./screen-geometry";

const log = createLogger("travel-frame");

/** The real window a travel drives — one OS call for both origin and size. */
export interface FrameWindow extends PetWindow {
  /** One OS call: global logical top-left and logical outer size. */
  setFrameLogical(x: number, y: number, width: number, height: number): Promise<void>;
}

export interface Travel {
  /** The window the movers drive during the travel. */
  win: PetWindow;
  /** Park the real window at the virtual window's current rect and clear the view offset. Idempotent. */
  end(): Promise<void>;
}

interface TravelState {
  origin: { x: number; y: number };
  size: { width: number; height: number };
  frameRect: { x: number; y: number; width: number; height: number };
  monitors: ScreenMonitor[];
  startScale: number;
  win: PetWindow;
  ended: boolean;
}

export function createTravelFrame(deps: {
  frame: FrameWindow;
  renderer: Pick<Renderer, "setViewWindow">;
  listMonitors(): Promise<ScreenMonitor[]>;
  setKeepOnScreenPaused(paused: boolean): void;
}): {
  /** Park the real window over the start rect and `end` (a window origin, logical px, same size) and hand back the virtual window. */
  begin(end: { x: number; y: number }): Promise<Travel>;
  /** The virtual window while a travel runs, else null. */
  current(): PetWindow | null;
} {
  let active: TravelState | null = null;

  function scaleAt(s: TravelState): number {
    return monitorAtLogical(s.monitors, s.origin.x, s.origin.y)?.scaleFactor ?? s.startScale;
  }

  function makeVirtualWindow(get: () => TravelState): PetWindow {
    return {
      async outerPosition() {
        const s = get();
        const scale = scaleAt(s);
        return { x: s.origin.x * scale, y: s.origin.y * scale };
      },
      async outerSize() {
        const s = get();
        const scale = scaleAt(s);
        return { width: s.size.width * scale, height: s.size.height * scale };
      },
      async scaleFactor() {
        return scaleAt(get());
      },
      async setPositionLogical(x, y) {
        const s = get();
        s.origin = { x, y };
        deps.renderer.setViewWindow({
          x: x - s.frameRect.x,
          y: y - s.frameRect.y,
          width: s.size.width,
          height: s.size.height,
        });
      },
    };
  }

  async function endState(s: TravelState): Promise<void> {
    if (s.ended) return;
    s.ended = true;
    if (active === s) active = null;
    await deps.frame.setFrameLogical(s.origin.x, s.origin.y, s.size.width, s.size.height);
    deps.renderer.setViewWindow(null);
    deps.setKeepOnScreenPaused(false);
    log.info("travel_end", { frame: s.frameRect, origin: s.origin });
  }

  return {
    async begin(end) {
      if (active) await endState(active);

      const [pos, size, sf, monitors] = await Promise.all([
        deps.frame.outerPosition(),
        deps.frame.outerSize(),
        deps.frame.scaleFactor(),
        deps.listMonitors(),
      ]);
      const scale = sf > 0 ? sf : 1;
      const start = { x: pos.x / scale, y: pos.y / scale };
      const logicalSize = { width: size.width / scale, height: size.height / scale };
      const frameRect = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width:
          Math.max(start.x + logicalSize.width, end.x + logicalSize.width) -
          Math.min(start.x, end.x),
        height:
          Math.max(start.y + logicalSize.height, end.y + logicalSize.height) -
          Math.min(start.y, end.y),
      };

      deps.setKeepOnScreenPaused(true);
      await deps.frame.setFrameLogical(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
      log.info("travel_begin", { start, end, frame: frameRect });

      const state: TravelState = {
        origin: { ...start },
        size: logicalSize,
        frameRect,
        monitors,
        startScale: scale,
        win: undefined as unknown as PetWindow,
        ended: false,
      };
      state.win = makeVirtualWindow(() => state);
      active = state;

      // Applied after the frame call resolves — an offset painted before it would be
      // a normal-size view drawn on the small pre-park canvas for one frame.
      deps.renderer.setViewWindow({
        x: start.x - frameRect.x,
        y: start.y - frameRect.y,
        width: logicalSize.width,
        height: logicalSize.height,
      });

      return { win: state.win, end: () => endState(state) };
    },
    current() {
      return active?.win ?? null;
    },
  };
}
