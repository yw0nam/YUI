/**
 * travel-frame — parks the real window once for a seam crossing.
 *
 * Every window move that straddles a scale boundary flashes a stale frame while AppKit
 * re-rasterizes the window at the old backing scale. A travel avoids the whole stretch of
 * per-frame moves that would cross the seam: it parks the real window once at the
 * bounding box of the path, then hands the mover a virtual window whose `setPositionLogical`
 * only redraws the reference-size framing at an offset inside that parked canvas
 * (`Renderer.setViewWindow`) — the real window never moves again until the travel ends.
 * `current()` keeps reporting the virtual window for the whole end() call, including its
 * own `setFrameLogical` round trip, so nobody observes the parked real window in between;
 * once ended, the virtual window degrades into forwarding straight to the real one.
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
  /** Set once the end frame call has settled — the virtual window then forwards to the real one. */
  ended: boolean;
  /** Set on the first end() call; every later call returns this same promise. */
  ending: Promise<void> | null;
}

export function createTravelFrame(deps: {
  frame: FrameWindow;
  renderer: Pick<Renderer, "setViewWindow">;
  listMonitors(): Promise<ScreenMonitor[]>;
  setKeepOnScreenPaused(paused: boolean): void;
}): {
  /**
   * Park the real window over the bounding box of the start rect, `end` and every `via`
   * origin (logical px, all the same size), and hand back the virtual window.
   */
  begin(end: { x: number; y: number }, via?: Array<{ x: number; y: number }>): Promise<Travel>;
  /** The virtual window while a travel runs or is ending, else null. */
  current(): PetWindow | null;
  /**
   * Ends whatever is happening right now: an active travel, or — for one still being
   * parked — the travel `begin` is in the middle of, unparked the moment its own frame
   * call lands, before it ever resolves to the caller. Resolves once fully unparked.
   * Two overlapping calls settle together, since both simply await the same in-flight
   * begin and/or end.
   */
  abort(): Promise<void>;
} {
  let active: TravelState | null = null;
  /** The in-flight begin() call, if any — `abort()` awaits it to know the attempt landed. */
  let pendingBegin: Promise<unknown> | null = null;
  /** Set by `abort()` while a begin is in flight; `begin` checks it right after its own
   *  frame call lands and, if set, ends the travel itself before resolving to the caller. */
  let abortRequested = false;

  function scaleAt(s: TravelState): number {
    return monitorAtLogical(s.monitors, s.origin.x, s.origin.y)?.scaleFactor ?? s.startScale;
  }

  function makeVirtualWindow(get: () => TravelState): PetWindow {
    return {
      async outerPosition() {
        const s = get();
        if (s.ended) return deps.frame.outerPosition();
        const scale = scaleAt(s);
        return { x: s.origin.x * scale, y: s.origin.y * scale };
      },
      async outerSize() {
        const s = get();
        if (s.ended) return deps.frame.outerSize();
        const scale = scaleAt(s);
        return { width: s.size.width * scale, height: s.size.height * scale };
      },
      async scaleFactor() {
        const s = get();
        if (s.ended) return deps.frame.scaleFactor();
        return scaleAt(s);
      },
      async setPositionLogical(x, y) {
        const s = get();
        if (s.ended) {
          await deps.frame.setPositionLogical(x, y);
          return;
        }
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

  /** Idempotent: a second call while one is pending returns the same promise. */
  function endState(s: TravelState): Promise<void> {
    if (s.ending) return s.ending;
    s.ending = (async () => {
      try {
        await deps.frame.setFrameLogical(s.origin.x, s.origin.y, s.size.width, s.size.height);
      } finally {
        // In a `finally` so a rejected frame call still hands the virtual window off to
        // the real one, clears the offset, and resumes the guard rather than stranding
        // them — whatever the real window's rect actually ended up at.
        s.ended = true;
        if (active === s) active = null;
        deps.renderer.setViewWindow(null);
        deps.setKeepOnScreenPaused(false);
        log.info("travel_end", { frame: s.frameRect, origin: s.origin });
      }
    })();
    return s.ending;
  }

  return {
    begin(end, via = []) {
      abortRequested = false;

      const attempt = (async (): Promise<Travel> => {
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
        const points = [start, end, ...via];
        const lefts = points.map((p) => p.x);
        const tops = points.map((p) => p.y);
        const rights = points.map((p) => p.x + logicalSize.width);
        const bottoms = points.map((p) => p.y + logicalSize.height);
        const frameRect = {
          x: Math.min(...lefts),
          y: Math.min(...tops),
          width: Math.max(...rights) - Math.min(...lefts),
          height: Math.max(...bottoms) - Math.min(...tops),
        };

        deps.setKeepOnScreenPaused(true);
        try {
          await deps.frame.setFrameLogical(
            frameRect.x,
            frameRect.y,
            frameRect.width,
            frameRect.height,
          );
        } catch (err) {
          deps.setKeepOnScreenPaused(false);
          throw err;
        }
        log.info("travel_begin", { start, end, via, frame: frameRect });

        const state: TravelState = {
          origin: { ...start },
          size: logicalSize,
          frameRect,
          monitors,
          startScale: scale,
          win: undefined as unknown as PetWindow,
          ended: false,
          ending: null,
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

        const travel: Travel = { win: state.win, end: () => endState(state) };

        // An abort() that arrived while this was parking ends it right here, before the
        // caller ever sees a travel it did not ask to keep — no caller-timing dependency.
        if (abortRequested) await endState(state);

        return travel;
      })();

      pendingBegin = attempt;
      void attempt
        .finally(() => {
          if (pendingBegin === attempt) pendingBegin = null;
        })
        .catch(() => {
          // A rejection is the caller's to handle via the returned `attempt`; this
          // bookkeeping copy must not surface as an unhandled rejection of its own.
        });

      return attempt;
    },
    current() {
      return active?.win ?? null;
    },
    async abort() {
      if (pendingBegin) {
        abortRequested = true;
        await pendingBegin.catch(() => {});
        return;
      }
      if (active) await endState(active);
    },
  };
}
