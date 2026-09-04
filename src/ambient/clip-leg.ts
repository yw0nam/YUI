/**
 * A window leg paced by a clip. The VRM plays an in-place clip at scene origin while the
 * OS window supplies the travel the loader levelled out of it — along the clip's own hips
 * curve, stretched to a chosen span, or on the leg's own clock — until the travel is
 * spent, the clip ends, or the leg is cut short. The climber's wall legs and the sitter's
 * seat transitions run on it.
 */

import type { MotionKind } from "../contract";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { MAX_STEP_DT_S } from "./walker";

const log = createLogger("clip-leg");

/** The window a leg moves. */
export interface LegWindow {
  setPositionPhysical(x: number, y: number): Promise<void>;
}

/** One leg: which clip paces it, and how far the window travels. */
export interface ClipLeg {
  /** null paces the clip without moving anything. */
  win: LegWindow | null;
  /** Only a linear leg moves x — the hang, carrying her off the corner onto the face. */
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  motionId: string;
  /** Name this leg goes by in the geometry log. */
  phase: string;
  /** Physical px per metre — the leg's own projection. */
  pxPerMetre: number;
  /** x eases over this many seconds; the hang drives y this way too. null = no easing. */
  linearS: number | null;
  /** y follows the clip's own rise curve rather than the leg's own clock. */
  curveY: boolean;
  /**
   * y spans fromY→toY over the clip's whole travel, whichever way the clip goes, and the
   * leg ends with the clip rather than on arrival. `pxPerMetre` is not read.
   */
  fit: boolean;
  /** The clip ends by itself, so losing it means the leg is over rather than interrupted. */
  oneshot: boolean;
  /** End the leg this many seconds before its clip ends, so the next clip blends out of it. */
  handoffS: number;
}

export interface LegRunnerDeps {
  renderer: Pick<
    Renderer,
    | "playMotion"
    | "getCurrentMotion"
    | "getCurrentMotionTime"
    | "getMotionDuration"
    | "getMotionTravelY"
    | "getMotionTravelAt"
  >;
  /** Registry kind of the committed motion. null when nothing is playing. */
  currentMotionKind(): MotionKind | null;
}

export interface LegRunner {
  /** Run one leg to completion. Resolves "lost" when the leg is finished from outside. */
  run(spec: ClipLeg): Promise<"done" | "lost">;
  /** One frame of travel. A clip that is not ours holds the window where it is. */
  step(dt: number): void;
  /** End the running leg now, if any. */
  finish(outcome: "done" | "lost"): void;
  /** The running leg's name and where it has the window, or null. */
  current(): { phase: string; x: number; y: number } | null;
}

interface RunningLeg extends ClipLeg {
  x: number;
  y: number;
  elapsedS: number;
  /** Clip travel where the leg picked the curve up — legs can share a running clip. */
  travel0: number | null;
  /** Clip playhead last frame, so a loop restart can be counted. */
  prevT: number;
  /** Loop restarts so far; each one adds a whole cycle of travel. */
  wraps: number;
  settle: (r: "done" | "lost") => void;
}

export function createLegRunner(deps: LegRunnerDeps): LegRunner {
  const { renderer } = deps;
  let leg: RunningLeg | null = null;

  function finish(outcome: "done" | "lost"): void {
    const l = leg;
    if (!l) return;
    leg = null;
    l.settle(outcome);
  }

  function moveTo(l: RunningLeg): void {
    if (!l.win) return;
    void l.win
      .setPositionPhysical(Math.round(l.x), Math.round(l.y))
      .catch((err) => log.warn("move_failed", { degrade: true, error: String(err) }));
  }

  function run(spec: ClipLeg): Promise<"done" | "lost"> {
    if (!spec.fit && spec.toY === spec.fromY && spec.toX === spec.fromX) {
      return Promise.resolve("done");
    }
    // A leg can inherit a clip that is already running — the descent picks up the one the
    // hang started — so its travel baseline is where that clip has already got to. A leg
    // that requests its own clip starts from the clip's first key, whenever it lands.
    const continuing = renderer.getCurrentMotion()?.id === spec.motionId;
    const now = continuing ? renderer.getCurrentMotionTime() : null;
    const travel0 = continuing
      ? now === null
        ? null
        : renderer.getMotionTravelAt(spec.motionId, now)
      : 0;
    if (!continuing) {
      renderer.playMotion({ id: spec.motionId });
      if (renderer.getCurrentMotion()?.id !== spec.motionId) return Promise.resolve("lost");
    }
    return new Promise((settle) => {
      leg = {
        ...spec,
        x: spec.fromX,
        y: spec.fromY,
        elapsedS: 0,
        travel0,
        prevT: now ?? 0,
        wraps: 0,
        settle,
      };
    });
  }

  function step(dt: number): void {
    const l = leg;
    if (!l) return;
    if (renderer.getCurrentMotion()?.id !== l.motionId) {
      // Anything but the ambient baseline is holding the body: wait it out where we are.
      if (deps.currentMotionKind() !== "ambient") return;
      // A oneshot that reached its own end is finished, not interrupted — replaying it
      // would restart the transition. Take the travel it still owed and end the leg.
      if (l.oneshot) {
        l.x = l.toX;
        l.y = l.toY;
        moveTo(l);
        finish("done");
        return;
      }
      // The replayed clip restarts at 0 without having finished its cycle: rebase the
      // leg on where the hold left the window rather than let the restart count as a wrap.
      l.fromY = l.y;
      l.travel0 = null;
      l.wraps = 0;
      l.prevT = 0;
      renderer.playMotion({ id: l.motionId });
      return;
    }
    if (l.handoffS > 0) {
      const t = renderer.getCurrentMotionTime();
      const duration = renderer.getMotionDuration(l.motionId);
      if (t !== null && duration !== null && t >= duration - l.handoffS) {
        l.x = l.toX;
        l.y = l.toY;
        moveTo(l);
        finish("done");
        return;
      }
    }
    const step = Math.min(dt, MAX_STEP_DT_S);
    if (l.linearS !== null) {
      l.elapsedS += step;
      const t = Math.min(l.elapsedS / l.linearS, 1);
      l.x = l.fromX + (l.toX - l.fromX) * t;
      // The hang has no clip travel of its own — it is a synthetic slide onto the wall.
      if (!l.curveY) l.y = l.fromY + (l.toY - l.fromY) * t;
    }
    if (l.curveY && !advanceOnCurve(l)) return;
    moveTo(l);
    if (!l.fit && l.y === l.toY && l.x === l.toX) finish("done");
  }

  /**
   * Put the window exactly where the clip's own hips have travelled since the leg picked
   * it up, wraps included. A straight line through the clip would let the body lead the
   * window through the middle of a rise that is not evenly paced. false until measurable.
   */
  function advanceOnCurve(l: RunningLeg): boolean {
    const t = renderer.getCurrentMotionTime();
    const at = t === null ? null : renderer.getMotionTravelAt(l.motionId, t);
    const total = renderer.getMotionTravelY(l.motionId);
    if (t === null || at === null || total === null) return false;
    if (total === 0) {
      // A clip with no travel of its own has nothing to pace a fit by; it holds its span.
      if (!l.fit) return false;
      l.y = l.toY;
      return true;
    }
    if (l.travel0 === null) {
      // The clip was not measurable when the leg opened; take the baseline now.
      l.travel0 = at;
      l.prevT = t;
    }
    // A looping clip restarts its playhead; each restart is another whole cycle travelled.
    if (t < l.prevT) l.wraps += 1;
    l.prevT = t;
    const travelled = at + l.wraps * total - l.travel0;
    const next = l.fit
      ? l.fromY + (l.toY - l.fromY) * (travelled / total)
      : l.fromY - travelled * l.pxPerMetre;
    // Snap on arrival rather than comparing floats that were reached two different ways.
    const reached = l.toY >= l.fromY ? next >= l.toY : next <= l.toY;
    l.y = reached ? l.toY : next;
    return true;
  }

  return {
    run,
    step,
    finish,
    current() {
      return leg ? { phase: leg.phase, x: leg.x, y: leg.y } : null;
    },
  };
}
