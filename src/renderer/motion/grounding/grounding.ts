/** Writes vrm.scene.position.y each frame: the perch offset plus the grounded share of the sole offset. */
import type { Logger } from "../../../logger";
import type { VrmParticipant } from "../../vrm-participant";
import { soleOffset } from "./sole-offset";
import { extractSoleBones, type SoleBone } from "./sole-points";

export function createGrounding(deps: {
  groundedWeight(): number;
  perchOffsetY(): number;
  log: Pick<Logger, "debug">;
}): VrmParticipant {
  let soles: SoleBone[] = [];
  return {
    onVrmLoaded(vrm) {
      const start = performance.now();
      soles = extractSoleBones(vrm);
      deps.log.debug("sole_points", {
        bones: soles.length,
        points: soles.reduce((n, s) => n + s.points.length, 0),
        ms: Math.round(performance.now() - start),
      });
    },
    onVrmDisposed() {
      soles = [];
    },
    step({ vrm }) {
      const weight = deps.groundedWeight();
      vrm.scene.position.y =
        deps.perchOffsetY() + (weight > 0 ? weight * soleOffset(vrm, soles) : 0);
    },
  };
}
