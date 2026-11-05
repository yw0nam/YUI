/**
 * perch-follow — carries a seated character with her host window.
 *
 * While a sit is armed, each step reads the host's bounds and moves the pet window by the
 * host's delta: a move follows in x and y, a resize follows the top edge only. The seat is
 * lost when it leaves the host's width or every monitor. Covered and gone stay with the
 * perch poll.
 */

import type { WindowRect } from "../../../../contract";
import {
  monitorAtLogical,
  type ScreenMonitor,
} from "../../../../io/window/geometry/screen-geometry";
import { createLogger } from "../../../../logger";
import { type DropWindow, type PerchProbeSource, projectSeat } from "./perch-watch";

const log = createLogger("perch-follow");

/** About one frame at 60 Hz. */
const FOLLOW_MS = 16;

export interface PerchFollowDeps {
  windowBounds(windowNumber: number): Promise<WindowRect | null>;
  getWindow: () => DropWindow;
  renderer: Pick<PerchProbeSource, "getPerchProbe" | "isPerched">;
  listMonitors(): Promise<ScreenMonitor[]>;
  /** Pause the keep-on-screen guard while the follow owns the window position. */
  setGuardPaused(paused: boolean): void;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export interface PerchFollow {
  /** Follow a host from now on, replacing a running follow; `onLost` runs once when the seat is lost. */
  start(windowNumber: number, onLost: () => void): void;
  /** Stop following; an in-flight step writes nothing. */
  stop(): void;
}

export function createPerchFollow(deps: PerchFollowDeps): PerchFollow {
  let timer: ReturnType<typeof setInterval> | null = null;
  let windowNumber = 0;
  let onLost: () => void = () => {};
  let last: WindowRect | null = null;
  let monitors: ScreenMonitor[] | null = null;
  let busy = false;
  let stepFailureLogged = false;
  // Bumped on every start/stop; a step discards its result when it changed mid-await.
  let gen = 0;

  function stop(): void {
    gen++;
    busy = false;
    if (timer === null) return;
    deps.clearInterval(timer);
    timer = null;
    deps.setGuardPaused(false);
  }

  function lose(reason: "off_width" | "off_screen"): void {
    stop();
    log.info("perch.follow_lost", { reason, windowNumber });
    onLost();
  }

  /** Reads the monitors; a read that finishes after a stop or restart leaves the cache alone. */
  async function readMonitors(g: number): Promise<ScreenMonitor[]> {
    const read = await deps.listMonitors();
    if (g === gen) monitors = read;
    return read;
  }

  async function step(g: number): Promise<void> {
    if (busy || !deps.renderer.isPerched()) return;
    busy = true;
    try {
      const b = await deps.windowBounds(windowNumber);
      if (g !== gen || !b) return;
      // The first read is the baseline: the arm-time rect is stale after a stroll.
      const prev = last;
      if (!prev) {
        last = b;
        return;
      }
      const resized = b.width !== prev.width;
      const dy = b.y - prev.y;
      const dx = resized ? 0 : b.x - prev.x;
      if (!resized && dx === 0 && dy === 0) return;
      const win = deps.getWindow();
      const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
      if (g !== gen) return;
      const next = { x: Math.round(pos.x + dx * scale), y: Math.round(pos.y + dy * scale) };
      if (dx !== 0 || dy !== 0) await win.setPositionPhysical?.(next.x, next.y);
      if (g !== gen) return;
      last = b;
      const probe = deps.renderer.getPerchProbe();
      if (!probe) return;
      const seat = projectSeat(probe, next, scale);
      if (seat.x < b.x || seat.x > b.x + b.width) return lose("off_width");
      const known = monitors ?? (await readMonitors(g));
      if (g !== gen) return;
      if (!monitorAtLogical(known, seat.x, seat.y)) {
        const fresh = await readMonitors(g);
        if (g === gen && !monitorAtLogical(fresh, seat.x, seat.y)) lose("off_screen");
      }
    } finally {
      if (g === gen) busy = false;
    }
  }

  return {
    start(n, lost) {
      stop();
      windowNumber = n;
      onLost = lost;
      last = null;
      monitors = null;
      stepFailureLogged = false;
      deps.setGuardPaused(true);
      const g = gen;
      timer = deps.setInterval(() => {
        void step(g).catch((err) => {
          if (stepFailureLogged) return;
          stepFailureLogged = true;
          log.warn("perch.follow_step_failed", { degrade: true, error: String(err) });
        });
      }, FOLLOW_MS);
    },
    stop,
  };
}
