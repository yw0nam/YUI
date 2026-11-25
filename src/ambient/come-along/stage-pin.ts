import type { EdgeEntry } from "../../config/validators/avatar/types";
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
}): {
  /** Plans the pin for `edge` in a window `windowWidth` px wide; null plans none. */
  plan(edge: EdgeEntry | null, windowWidth: number): void;
  /** Arms the planned pin, eased in over `easeMs` when given. */
  arm(easeMs?: number): void;
  /** `clip` plays: the pin lets go once it stops, or idles her at its `play_ms`. */
  watch(clip: string): void;
  /** Stops watching, drops the plan, and clears an armed pin at once. */
  snap(): void;
} {
  const { renderer } = deps;
  let planned: { edge: EdgeEntry; windowWidth: number } | null = null;
  let pinned = false;
  let stopWatch: (() => void) | null = null;

  function stop(): void {
    stopWatch?.();
    stopWatch = null;
    pinned = false;
  }

  function easeBack(): void {
    pinned = false;
    renderer.setPeekTarget(null, deps.reducedMotion() ? undefined : { easeMs: deps.releaseMs() });
  }

  return {
    plan(edge, windowWidth) {
      planned = edge && { edge, windowWidth };
    },
    arm(easeMs) {
      const probe = planned && renderer.getPerchProbe();
      if (!planned || !probe) return;
      renderer.setMotionMirror(false);
      pinned = renderer.setPeekTarget({
        targetXpx: peekTargetPx(planned.windowWidth, "left", probe.charHpx, planned.edge.inset),
        ...(easeMs !== undefined && { easeMs }),
        holdsPosture: false,
      });
    },
    watch(clip) {
      const edge = planned?.edge;
      planned = null;
      if (!pinned || !edge) return;
      stopWatch = renderer.onTick(() => {
        const playing = renderer.getCurrentMotion()?.id === clip;
        if (!pinned) {
          // A `play_ms` clip loops as a state the controller returns to; she idles instead.
          if (playing) {
            stop();
            renderer.playMotion(null);
          }
          return;
        }
        if (!playing) {
          easeBack();
          if (edge.play_ms === undefined) stop();
          return;
        }
        const playedS = renderer.getCurrentMotionTime();
        if (edge.play_ms !== undefined && playedS !== null && playedS * 1000 >= edge.play_ms) {
          stop();
          renderer.playMotion(null);
          easeBack();
        }
      });
    },
    snap() {
      const wasPinned = pinned;
      planned = null;
      stop();
      if (wasPinned) renderer.setPeekTarget(null);
    },
  };
}
