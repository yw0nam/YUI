import { isObject } from "../shared";
import { num, type SectionContext } from "./helpers";
import type { GazeKnobs } from "./types";

// gaze — cursor tracking angles and damping.
export function validateGaze(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<GazeKnobs> {
  const { issues } = ctx;
  const gaze: Partial<GazeKnobs> = {};
  const rawGaze = raw.gaze;
  if (!isObject(rawGaze)) {
    issues.push(`gaze must be an object (got: ${JSON.stringify(rawGaze)})`);
  } else {
    /** Only deadDeg and headNeckSplit accept their lower bound; the other angles are above it. */
    const ranged = (
      key: keyof GazeKnobs,
      min: number,
      max: number,
      minInclusive: boolean,
    ): void => {
      gaze[key] = num(
        issues,
        rawGaze,
        "gaze",
        key,
        (v) => (minInclusive ? v >= min : v > min) && v <= max,
        `a finite number in ${minInclusive ? "[" : "("}${min}, ${max}]`,
      );
    };
    ranged("deadDeg", 0, 180, true);
    ranged("headEngageDeg", 0, 180, false);
    ranged("disengageDeg", 0, 180, false);
    // Zero degrees per mount width would freeze tracking, which the gaze on/off toggle owns;
    // the ceiling matches the other degree-valued keys.
    ranged("sensitivity", 0, 180, false);
    ranged("maxHeadYaw", 0, 90, false);
    ranged("maxHeadPitch", 0, 90, false);
    ranged("eyeMaxDeg", 0, 90, false);
    ranged("headNeckSplit", 0, 1, true);
    ranged("smooth", 0, 1000, false);
  }
  return gaze;
}
