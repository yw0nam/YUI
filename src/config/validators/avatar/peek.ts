import { isObject } from "../shared";
import { num, type SectionContext, unit } from "./helpers";
import type { PeekConfig } from "./types";

// peek — side-peek geometry and mirroring.
export function validatePeek(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<PeekConfig> {
  const { issues } = ctx;
  const peek: Partial<PeekConfig> = {};
  const rawPeek = raw.peek;
  if (!isObject(rawPeek)) {
    issues.push(`peek must be an object (got: ${JSON.stringify(rawPeek)})`);
  } else {
    for (const field of ["side_out_frac", "side_in_frac"] as const) {
      peek[field] = num(
        issues,
        rawPeek,
        "peek",
        field,
        (v) => v > 0 && v <= 2,
        "a finite number in (0, 2]",
      );
    }
    peek.inset_frac = num(issues, rawPeek, "peek", "inset_frac", unit, "a finite number in [0, 1]");
    const mirrorSide = rawPeek.mirror_side;
    if (mirrorSide !== "left" && mirrorSide !== "right" && mirrorSide !== "none") {
      issues.push(
        `peek.mirror_side must be one of left|right|none (got: ${JSON.stringify(mirrorSide)})`,
      );
    } else {
      peek.mirror_side = mirrorSide;
    }
  }
  return peek;
}
