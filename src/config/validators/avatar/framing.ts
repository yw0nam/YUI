import { isObject } from "../shared";
import { nonNegative, num, type SectionContext } from "./helpers";
import type { FramingConfig } from "./types";

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
  }
  return framing;
}
