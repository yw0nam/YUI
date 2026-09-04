/**
 * Seat transitions — the sit-down that puts the character onto a window top and the
 * stand-up that takes her off it, played before the seat is taken or left. The clips are
 * root-locked, so the OS window supplies the descent and the rise: it follows each clip's
 * own hips curve, stretched so that the sit lands the hips on the edge and the stand puts
 * the feet back on it. Whoever seats or unseats her runs the transition first and carries
 * on when it resolves; a transition cut short by a pickup resolves "lost".
 */

import type { MotionKind } from "../contract";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { createLegRunner, type LegWindow } from "./clip-leg";

const log = createLogger("sitter");

/** Registry id of the sit-down onto a ledge. */
export const SIT_DOWN_MOTION_ID = "sit_down";
/** Registry id of the stand-up off a ledge. */
export const STAND_UP_MOTION_ID = "stand_up";
/**
 * How long before a transition clip ends the next clip takes the body. The seat or the walk
 * crossfades out of the clip's settled last stretch; a oneshot left to run out drops the
 * body through idle first.
 */
export const SEAT_HANDOFF_S = 0.5;

export interface SeatWindow extends LegWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
}

export interface SitterDeps {
  renderer: Pick<
    Renderer,
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "getCurrentMotionTime"
    | "getMotionDuration"
    | "getMotionTravelY"
    | "getMotionTravelAt"
    | "preloadMotion"
    | "getCharacterAnchor"
    | "getPerchProbe"
  >;
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
}

export interface Sitter {
  /** Register the frame hook. */
  start(): void;
  stop(): void;
  /**
   * Sit down onto the edge under the feet. With a window, it sinks by the standing seat
   * height — the feet on the edge become the hips on it — along the clip's curve; without
   * one, or with a body the renderer cannot measure, the clip plays in place.
   */
  sitDown(target: { win: SeatWindow; scale: number } | null): Promise<"done" | "lost">;
  /** Stand up, the window rising along the clip's curve to `toY` (physical px). */
  standUp(win: SeatWindow, toY: number): Promise<"done" | "lost">;
  /** End a running transition now, handing its clip back. */
  cancel(): void;
}

export function createSitter(deps: SitterDeps): Sitter {
  const { renderer } = deps;
  const runner = createLegRunner({ renderer, currentMotionKind: deps.currentMotionKind });
  let unsub: (() => void) | null = null;
  /** Bumped by every cancel and every new transition, so a stale one drops its plan. */
  let generation = 0;

  function cancel(): void {
    generation += 1;
    runner.finish("lost");
    const current = renderer.getCurrentMotion();
    if (current && (current.id === SIT_DOWN_MOTION_ID || current.id === STAND_UP_MOTION_ID)) {
      renderer.playMotion(null);
    }
  }

  async function transition(
    motionId: string,
    win: SeatWindow | null,
    toY: (at: { x: number; y: number }) => number,
  ): Promise<"done" | "lost"> {
    cancel();
    const startedAt = generation;
    await renderer.preloadMotion(motionId);
    if (generation !== startedAt) return "lost";
    let from = { x: 0, y: 0 };
    if (win) {
      from = await win.outerPosition();
      if (generation !== startedAt) return "lost";
    }
    const to = win ? toY(from) : from.y;
    log.debug("transition", { motionId, fromY: Math.round(from.y), toY: Math.round(to) });
    return runner.run({
      win,
      fromX: from.x,
      toX: from.x,
      fromY: from.y,
      toY: to,
      motionId,
      phase: motionId,
      pxPerMetre: 0,
      linearS: null,
      curveY: true,
      fit: true,
      oneshot: true,
      handoffS: SEAT_HANDOFF_S,
    });
  }

  return {
    start() {
      if (unsub) return;
      unsub = renderer.onTick(({ dt }) => runner.step(dt));
    },
    stop() {
      cancel();
      unsub?.();
      unsub = null;
    },
    sitDown(target) {
      // The seat sits this far above the feet while she stands; the window sinks by it.
      const anchor = renderer.getCharacterAnchor();
      const probe = renderer.getPerchProbe();
      const dropPx = target && anchor && probe ? (anchor.y - probe.seatPx.y) * target.scale : 0;
      const win = target && dropPx > 0 ? target.win : null;
      return transition(SIT_DOWN_MOTION_ID, win, (at) => at.y + dropPx);
    },
    standUp(win, toY) {
      return transition(STAND_UP_MOTION_ID, win, () => toY);
    },
    cancel,
  };
}
