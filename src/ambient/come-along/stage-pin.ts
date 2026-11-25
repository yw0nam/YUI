import type { EdgeEntry } from "../../config/validators/avatar/types";
import type { MotionKind } from "../../contract";
import type { Renderer } from "../../renderer";
import { peekTargetPx } from "../../renderer/geometry/probe/perch-geometry";

/**
 * The stage peek pin: an edge entry plays with her hips `inset` × her height beyond her window's
 * right edge, and the pin lets go when the clip stops or at its `play_ms`.
 */
export function createStagePin(deps: {
  renderer: Pick<
    Renderer,
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "getCurrentMotionTime"
    | "setPeekTarget"
    | "setMotionMirror"
    | "getPerchProbe"
  >;
  reducedMotion(): boolean;
  /** Time (ms) the pin takes to ease back to the centre. */
  releaseMs(): number;
  getMotionKind(id: string): MotionKind | undefined;
  /** The held pin lets go, easing back unless motion is reduced. */
  onRelease(): void;
}): {
  /** Plans the pin for `edge` in a window `windowWidth` px wide; null plans none. */
  plan(edge: EdgeEntry | null, windowWidth: number): void;
  /** Arms the planned pin, eased in over `easeMs` when given. */
  arm(easeMs?: number): void;
  /** Whether the renderer holds an armed pin. */
  holds(): boolean;
  /** Re-aims a held pin past the right edge of a window `windowWidth` px wide. */
  fit(windowWidth: number): void;
  /** An edge `clip` plays: the pin lets go once it stops, and she idles at its `play_ms`. */
  watch(clip: string): void;
  /** Stops watching, drops the plan, and clears an armed pin at once. */
  snap(): void;
} {
  const { renderer } = deps;
  let planned: { edge: EdgeEntry; windowWidth: number } | null = null;
  // The held pin's inset and its target, null while none is held.
  let pinned: { inset: number; targetXpx: number } | null = null;
  let stopWatch: (() => void) | null = null;

  function stop(): void {
    stopWatch?.();
    stopWatch = null;
  }

  /** Eases an armed pin back to the centre. */
  function release(): void {
    if (!pinned) return;
    pinned = null;
    renderer.setPeekTarget(null, deps.reducedMotion() ? undefined : { easeMs: deps.releaseMs() });
    deps.onRelease();
  }

  return {
    plan(edge, windowWidth) {
      planned = edge && { edge, windowWidth };
    },
    arm(easeMs) {
      const probe = planned && renderer.getPerchProbe();
      if (!planned || !probe) return;
      renderer.setMotionMirror(false);
      const { inset } = planned.edge;
      const targetXpx = peekTargetPx(planned.windowWidth, "left", probe.charHpx, inset);
      const accepted = renderer.setPeekTarget({
        targetXpx,
        ...(easeMs !== undefined && { easeMs }),
        holdsPosture: false,
      });
      pinned = accepted ? { inset, targetXpx } : null;
    },
    holds: () => pinned !== null,
    fit(windowWidth) {
      const probe = pinned && renderer.getPerchProbe();
      if (!pinned || !probe) return;
      const targetXpx = peekTargetPx(windowWidth, "left", probe.charHpx, pinned.inset);
      if (targetXpx === pinned.targetXpx) return;
      pinned.targetXpx = targetXpx;
      renderer.setPeekTarget({ targetXpx, holdsPosture: false });
    },
    watch(clip) {
      const edge = planned?.edge;
      planned = null;
      if (!edge) return;
      // A state clip is the motion controller's return target once whatever replaced it ends.
      const returns = deps.getMotionKind(clip) === "state";
      let replaced = false;
      stopWatch = renderer.onTick(() => {
        const playing = renderer.getCurrentMotion()?.id === clip;
        if (replaced) {
          if (playing) {
            stop();
            renderer.playMotion(null);
          }
          return;
        }
        if (!playing) {
          release();
          if (returns) replaced = true;
          else stop();
          return;
        }
        const playedS = renderer.getCurrentMotionTime();
        if (edge.play_ms !== undefined && playedS !== null && playedS * 1000 >= edge.play_ms) {
          stop();
          renderer.playMotion(null);
          release();
        }
      });
    },
    snap() {
      planned = null;
      stop();
      if (pinned) renderer.setPeekTarget(null);
      pinned = null;
    },
  };
}
