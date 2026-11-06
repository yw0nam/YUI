/**
 * perch-follow — carries a seated character with her host window.
 *
 * While a sit is armed, each step reads the host's bounds and moves the pet window by the
 * host's delta: a move follows in x and y, a resize follows the top edge only. The seat is
 * lost when it leaves the host's width or every monitor. Covered and gone stay with the
 * perch poll.
 *
 * The pet position is read once, at the baseline, and then carried in logical points: a
 * physical position is in the backing scale of the moment, which changes while she crosses
 * onto a monitor of another scale.
 */

import type { WindowRect } from "../../../../contract";
import {
  monitorAtLogical,
  type ScreenMonitor,
} from "../../../../io/window/geometry/screen-geometry";
import { createLogger } from "../../../../logger";
import type { DropWindow, PerchProbeSource } from "./perch-watch";

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
  // Detached: WebKit rejects a native timer called as a method of anything but the window.
  const setIntervalImpl = deps.setInterval;
  const clearIntervalImpl = deps.clearInterval;
  let timer: ReturnType<typeof setInterval> | null = null;
  let windowNumber = 0;
  let onLost: () => void = () => {};
  let last: WindowRect | null = null;
  // The pet window's top-left in logical points, from the baseline on.
  let pet: { x: number; y: number } | null = null;
  let monitors: ScreenMonitor[] | null = null;
  let busy = false;
  let stepFailureLogged = false;
  // Bumped on every start/stop; a step discards its result when it changed mid-await.
  let gen = 0;

  function stop(): void {
    gen++;
    busy = false;
    if (timer === null) return;
    clearIntervalImpl(timer);
    timer = null;
    deps.setGuardPaused(false);
  }

  function lose(
    reason: "off_width" | "off_screen",
    seat: { x: number; y: number },
    host: WindowRect,
  ): void {
    stop();
    log.info("perch.follow_lost", {
      reason,
      windowNumber,
      seat: { x: Math.round(seat.x), y: Math.round(seat.y) },
      host: { x: host.x, y: host.y, width: host.width },
    });
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
      if (!prev || !pet) {
        const win = deps.getWindow();
        const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
        if (g !== gen) return;
        pet = { x: pos.x / scale, y: pos.y / scale };
        last = b;
        return;
      }
      const resized = b.width !== prev.width;
      const dy = b.y - prev.y;
      const dx = resized ? 0 : b.x - prev.x;
      if (!resized && dx === 0 && dy === 0) return;
      const next = { x: pet.x + dx, y: pet.y + dy };
      const probe = deps.renderer.getPerchProbe();
      const seat = probe ? { x: next.x + probe.seatPx.x, y: next.y + probe.seatPx.y } : null;
      // Off every screen the seat is lost where she stands, so the fall starts on screen.
      if (seat) {
        const known = monitors ?? (await readMonitors(g));
        if (g !== gen) return;
        if (!monitorAtLogical(known, seat.x, seat.y)) {
          const fresh = await readMonitors(g);
          if (g !== gen) return;
          if (!monitorAtLogical(fresh, seat.x, seat.y)) return lose("off_screen", seat, b);
        }
      }
      if (dx !== 0 || dy !== 0) await deps.getWindow().setPositionLogical?.(next.x, next.y);
      if (g !== gen) return;
      pet = next;
      last = b;
      if (seat && (seat.x < b.x || seat.x > b.x + b.width)) lose("off_width", seat, b);
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
      pet = null;
      monitors = null;
      stepFailureLogged = false;
      deps.setGuardPaused(true);
      const g = gen;
      timer = setIntervalImpl(() => {
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
