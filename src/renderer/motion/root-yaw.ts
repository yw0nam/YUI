/** Root yaw: the eased facing the ambient stroll turns the character by, written onto the model's base rotation each frame. */
import type { VRM } from "@pixiv/three-vrm";
import { yawAt } from "../geometry/body-yaw";
import type { VrmParticipant } from "../vrm-participant";

export interface RootYaw extends VrmParticipant {
  onVrmLoaded(vrm: VRM): void;
  isConverging(): boolean;
  /** Ease the yaw to `rad` over `easeMs` from now; a non-finite `rad` is ignored. */
  setTarget(rad: number, easeMs: number): void;
}

export function createRootYaw(deps: { getElapsedMs: () => number }): RootYaw {
  // vrm.scene.rotation.y is a channel nothing else writes after load — the mixer
  // animates bones and the pins own scene.position — so the eased yaw is applied
  // on top of the model's own base rotation (π for VRM0, 0 for VRM1).
  let baseYaw = 0;
  let bodyYaw = 0;
  let bodyYawFrom = 0;
  let bodyYawTo = 0;
  let bodyYawStartMs = 0;
  let bodyYawDurationMs = 0;
  let bodyYawConverging = false;

  return {
    onVrmLoaded(vrm) {
      // The model's own front-facing rotation is the baseline the stroll yaw adds onto.
      baseYaw = vrm.scene.rotation.y;
      bodyYaw = 0;
      bodyYawConverging = false;
    },
    /** One frame of the root-yaw ease, written absolutely onto the model's base rotation. */
    step(ctx) {
      if (bodyYawConverging) {
        const t = deps.getElapsedMs() - bodyYawStartMs;
        bodyYaw = yawAt(bodyYawFrom, bodyYawTo, t, bodyYawDurationMs);
        if (t >= bodyYawDurationMs) bodyYawConverging = false;
      }
      ctx.vrm.scene.rotation.y = baseYaw + bodyYaw;
    },
    isConverging() {
      return bodyYawConverging;
    },
    setTarget(rad, easeMs) {
      if (!Number.isFinite(rad)) return;
      bodyYawFrom = bodyYaw;
      bodyYawTo = rad;
      bodyYawStartMs = deps.getElapsedMs();
      bodyYawDurationMs = Number.isFinite(easeMs) ? Math.max(0, easeMs) : 0;
      bodyYawConverging = true;
    },
  };
}
