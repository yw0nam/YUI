import type { FitBandConfig, FramingConfig } from "../../load";
import { isObject } from "../shared";
import { nonNegative, num, type SectionContext, unit } from "./helpers";

// framing — fit-to-bounds camera.
export function validateFraming(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<FramingConfig> {
  const { issues } = ctx;
  const framing: Partial<FramingConfig> = {};
  const rawFraming = raw.framing;
  if (!isObject(rawFraming)) {
    issues.push(`framing must be an object (got: ${JSON.stringify(rawFraming)})`);
  } else {
    framing.margin = num(
      issues,
      rawFraming,
      "framing",
      "margin",
      nonNegative,
      "a finite number >= 0",
    );
    framing.fov = num(
      issues,
      rawFraming,
      "framing",
      "fov",
      (v) => v > 0 && v < 180,
      "a finite number in (0, 180)",
    );
    const rawBand = rawFraming.upper_body;
    if (!isObject(rawBand)) {
      issues.push(`framing.upper_body must be an object (got: ${JSON.stringify(rawBand)})`);
    } else {
      const band: Partial<FitBandConfig> = {};
      for (const key of ["from_frac", "to_frac"] as const) {
        band[key] = num(
          issues,
          rawBand,
          "framing.upper_body",
          key,
          unit,
          "a finite number in [0, 1]",
        );
      }
      const { from_frac, to_frac } = band;
      if (from_frac !== undefined && to_frac !== undefined && from_frac >= to_frac) {
        issues.push(
          `framing.upper_body.from_frac must be < framing.upper_body.to_frac (got: ${from_frac} >= ${to_frac})`,
        );
      }
      framing.upper_body = band as FitBandConfig;
    }
  }
  return framing;
}
