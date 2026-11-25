import type { EdgeEntry } from "../../config/validators/avatar/types";
import type { MotionKind } from "../../contract";
import type { Renderer } from "../../renderer";
import { peekTargetPx } from "../../renderer/geometry/probe/perch-geometry";

/**
 * The stage peek pin: an edge entry plays with her hips `inset` × her height beyond her window's
 * right edge, and the pin lets go when the clip stops or at its `play_ms`. Her height is the probe's,
 * scaled by `heightScale` when her window is about to take another height.
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
}): {
  /** Plans the pin for `edge`; null plans none. */
  plan(edge: EdgeEntry | null): void;
  /** Arms the planned pin past the right edge of a window `windowWidth` px wide, eased in over `easeMs` when given. */
  arm(windowWidth: number, heightScale: number, easeMs?: number): void;
  /** Re-aims a held pin past the right edge of a window `windowWidth` px wide. */
  reaim(windowWidth: number, heightScale: number): void;
  /** An edge `clip` plays: the pin lets go once it stops, and she idles at its `play_ms`. */
  watch(clip: string): void;
  /** Stops watching, drops the plan, and clears an armed pin at once. */
  snap(): void;
} {
  const { renderer } = deps;
  let planned: EdgeEntry | null = null;
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
  }

  return {
    plan(edge) {
      planned = edge;
    },
    arm(windowWidth, heightScale, easeMs) {
      const probe = planned && renderer.getPerchProbe();
      if (!planned || !probe) return;
      renderer.setMotionMirror(false);
      const { inset } = planned;
      const targetXpx = peekTargetPx(windowWidth, "left", probe.charHpx * heightScale, inset);
      const accepted = renderer.setPeekTarget({
        targetXpx,
        ...(easeMs !== undefined && { easeMs }),
        holdsPosture: false,
      });
      pinned = accepted ? { inset, targetXpx } : null;
    },
    reaim(windowWidth, heightScale) {
      const probe = pinned && renderer.getPerchProbe();
      if (!pinned || !probe) return;
      const targetXpx = peekTargetPx(
        windowWidth,
        "left",
        probe.charHpx * heightScale,
        pinned.inset,
      );
      if (targetXpx === pinned.targetXpx) return;
      pinned.targetXpx = targetXpx;
      renderer.setPeekTarget({ targetXpx, holdsPosture: false });
    },
    watch(clip) {
      const edge = planned;
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
