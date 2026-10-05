import { isObject } from "../shared";
import { int, nonNegative, num, positive, requireOrder, type SectionContext } from "./helpers";
import type { ClimbConfig } from "./types";

// climb — ambient window climb.
export function validateClimb(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<ClimbConfig> {
  const { issues } = ctx;
  const climb: Partial<ClimbConfig> = {};
  const rawClimb = raw.climb;
  if (!isObject(rawClimb)) {
    issues.push(`climb must be an object (got: ${JSON.stringify(rawClimb)})`);
  } else {
    for (const field of [
      "interval_min_ms",
      "interval_max_ms",
      "perch_dwell_min_ms",
      "perch_dwell_max_ms",
    ] as const) {
      climb[field] = int(issues, rawClimb, "climb", field, nonNegative, "an integer >= 0");
    }
    for (const field of [
      "max_height_frac",
      "hang_frac",
      "wall_offset_frac",
      "descent_wall_offset_frac",
      "ledge_walk_min_frac",
      "ledge_walk_max_frac",
    ] as const) {
      climb[field] = num(issues, rawClimb, "climb", field, positive, "a finite number > 0");
    }
    requireOrder(
      issues,
      "climb",
      "interval_min_ms",
      climb.interval_min_ms,
      "interval_max_ms",
      climb.interval_max_ms,
    );
    requireOrder(
      issues,
      "climb",
      "perch_dwell_min_ms",
      climb.perch_dwell_min_ms,
      "perch_dwell_max_ms",
      climb.perch_dwell_max_ms,
    );
    requireOrder(
      issues,
      "climb",
      "ledge_walk_min_frac",
      climb.ledge_walk_min_frac,
      "ledge_walk_max_frac",
      climb.ledge_walk_max_frac,
    );
  }
  return climb;
}
