/**
 * Seat transitions — taking a window seat and leaving it. The seat entry crossfades into
 * the seated clip while the OS window eases down by the standing-feet to seated-hips
 * distance; the exit crossfades to idle while the window eases up to the standing origin.
 * Whoever seats or unseats her runs the transition first and carries on when it resolves;
 * a transition cut short by a pickup resolves "lost".
 */

import { PERCH_MOTION_ID } from "../../io/window/geometry/perch";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import { easeInOut } from "../../renderer/motion/yaw/body-yaw";
import type { LegWindow } from "./clip-leg";
import type { WalkerDoc } from "./walk/walker";

const log = createLogger("sitter");

/** The motion crossfade and the window ease share this span. */
const SEAT_EASE_MS = 500;

export interface SeatWindow extends LegWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
}

export interface SitterDeps {
  renderer: Pick<
    Renderer,
    "onTick" | "playMotion" | "getCurrentMotion" | "getCharacterAnchor" | "getPerchProbe"
  >;
  /** Defaults to the global document; injected in tests. */
  doc?: WalkerDoc;
}

export interface Sitter {
  /** Register the frame hook. */
  start(): void;
  stop(): void;
  /**
   * Crossfade to the seated clip. With a window, it eases down by the standing seat
   * height — the feet on the edge become the hips on it; without one, or with a body the
   * renderer cannot measure, the clip fades in place.
   */
  sitDown(target: { win: SeatWindow; scale: number } | null): Promise<"done" | "lost">;
  /** Crossfade to idle, the window rising to `toY` (physical px). */
  standUp(win: SeatWindow, toY: number): Promise<"done" | "lost">;
  /** End a running transition now, handing a seated clip back. */
  cancel(): void;
}

interface Ease {
  sit: boolean;
  win: SeatWindow | null;
  x: number;
  fromY: number;
  toY: number;
  elapsedMs: number;
  settle: (r: "done" | "lost") => void;
}

export function createSitter(deps: SitterDeps): Sitter {
  const { renderer } = deps;
  const doc = deps.doc ?? (typeof document === "undefined" ? null : document);
  let unsub: (() => void) | null = null;
  /** Bumped by every cancel and every new transition, so a stale one drops its plan. */
  let generation = 0;
  let ease: Ease | null = null;

  function cancel(): void {
    generation += 1;
    const e = ease;
    if (!e) return;
    ease = null;
    e.settle("lost");
    if (e.sit && renderer.getCurrentMotion()?.id === PERCH_MOTION_ID) renderer.playMotion(null);
  }

  // The renderer parks its rAF while hidden, so a transition left running would never
  // resolve and its caller would wait on it — lose it instead.
  const onVisibilityChange = (): void => {
    if (doc?.visibilityState === "hidden") cancel();
  };

  function step(dt: number): void {
    const e = ease;
    if (!e) return;
    e.elapsedMs += dt * 1000;
    const done = e.elapsedMs >= SEAT_EASE_MS;
    const y = done ? e.toY : e.fromY + (e.toY - e.fromY) * easeInOut(e.elapsedMs / SEAT_EASE_MS);
    void e.win
      ?.setPositionPhysical(e.x, Math.round(y))
      .catch((err) => log.warn("move_failed", { degrade: true, error: String(err) }));
    if (done) {
      ease = null;
      e.settle("done");
    }
  }

  function startEase(
    sit: boolean,
    win: SeatWindow | null,
    from: { x: number; y: number },
    toY: number,
  ): Promise<"done" | "lost"> {
    log.debug("transition", { sit, fromY: Math.round(from.y), toY: Math.round(toY) });
    return new Promise((settle) => {
      ease = { sit, win, x: from.x, fromY: from.y, toY, elapsedMs: 0, settle };
      // No tick runs while hidden and no visibilitychange will come: finish in one step.
      if (doc?.visibilityState === "hidden") step(SEAT_EASE_MS / 1000);
    });
  }

  return {
    start() {
      if (unsub) return;
      doc?.addEventListener("visibilitychange", onVisibilityChange);
      unsub = renderer.onTick(({ dt }) => step(dt));
    },
    stop() {
      cancel();
      unsub?.();
      unsub = null;
      doc?.removeEventListener("visibilitychange", onVisibilityChange);
    },
    async sitDown(target) {
      cancel();
      const startedAt = generation;
      // The seat sits this far above the feet while she stands; the window sinks by it.
      const anchor = renderer.getCharacterAnchor();
      const probe = renderer.getPerchProbe();
      const dropPx = target && anchor && probe ? (anchor.y - probe.seatPx.y) * target.scale : 0;
      const win = target && dropPx > 0 ? target.win : null;
      const from = win ? await win.outerPosition() : { x: 0, y: 0 };
      if (generation !== startedAt) return "lost";
      renderer.playMotion({ id: PERCH_MOTION_ID, fade_ms: SEAT_EASE_MS });
      return startEase(true, win, from, from.y + dropPx);
    },
    async standUp(win, toY) {
      cancel();
      const startedAt = generation;
      const from = await win.outerPosition();
      if (generation !== startedAt) return "lost";
      renderer.playMotion(null);
      return startEase(false, win, from, toY);
    },
    cancel,
  };
}
