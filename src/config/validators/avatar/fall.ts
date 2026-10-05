import { isObject } from "../shared";
import { int, nonNegative, num, positive, type SectionContext, unit } from "./helpers";
import type { DescendConfig, FallConfig } from "./types";

// fall — drag-release dynamics and the surfaces a fall stops on.
export function validateFall(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<FallConfig> {
  const { issues } = ctx;
  const fall: Partial<FallConfig> = {};
  const rawFall = raw.fall;
  if (!isObject(rawFall)) {
    issues.push(`fall must be an object (got: ${JSON.stringify(rawFall)})`);
  } else {
    for (const field of ["gravity_px_s2", "max_speed_px_s", "land_room_frac"] as const) {
      fall[field] = num(issues, rawFall, "fall", field, positive, "a finite number > 0");
    }
    fall.min_drop_frac = num(
      issues,
      rawFall,
      "fall",
      "min_drop_frac",
      unit,
      "a finite number in [0, 1]",
    );
    fall.cue_cooldown_ms = int(
      issues,
      rawFall,
      "fall",
      "cue_cooldown_ms",
      nonNegative,
      "an integer >= 0",
    );
    fall.step_off_probability = num(
      issues,
      rawFall,
      "fall",
      "step_off_probability",
      unit,
      "a finite number in [0, 1]",
    );
  }
  return fall;
}

// descend — upper-to-lower monitor descent choices.
export function validateDescend(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<DescendConfig> {
  const { issues } = ctx;
  const descend: Partial<DescendConfig> = {};
  const rawDescend = raw.descend;
  if (!isObject(rawDescend)) {
    issues.push(`descend must be an object (got: ${JSON.stringify(rawDescend)})`);
  } else {
    for (const field of ["chance", "climb_down_chance"] as const) {
      descend[field] = num(issues, rawDescend, "descend", field, unit, "a finite number in [0, 1]");
    }
  }
  return descend;
}
