import type { JumpConfig } from "../../load";
import { isObject } from "../shared";
import { int, num, positive, type SectionContext, unit } from "./helpers";

// jump — window-to-window flight.
export function validateJump(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<JumpConfig> {
  const { issues } = ctx;
  const jump: Partial<JumpConfig> = {};
  const rawJump = raw.jump;
  if (!isObject(rawJump)) {
    issues.push(`jump must be an object (got: ${JSON.stringify(rawJump)})`);
  } else {
    for (const field of ["probability", "takeoff_frac", "land_frac"] as const) {
      jump[field] = num(issues, rawJump, "jump", field, unit, "a finite number in [0, 1]");
    }
    for (const field of [
      "height_up_max_frac",
      "height_down_max_frac",
      "gap_max_width_frac",
      "apex_lift_frac",
    ] as const) {
      jump[field] = num(issues, rawJump, "jump", field, positive, "a finite number > 0");
    }
    jump.flight_timeout_ms = int(
      issues,
      rawJump,
      "jump",
      "flight_timeout_ms",
      positive,
      "an integer > 0",
    );
    if (
      jump.takeoff_frac !== undefined &&
      jump.land_frac !== undefined &&
      jump.takeoff_frac >= jump.land_frac
    ) {
      issues.push(
        `jump.takeoff_frac must be < jump.land_frac (got: ${jump.takeoff_frac} >= ${jump.land_frac})`,
      );
    }
  }
  return jump;
}
