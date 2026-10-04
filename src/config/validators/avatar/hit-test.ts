import type { HitTestKnobs } from "../../load";
import { isObject } from "../shared";
import { int, nonNegative, num, positive, type SectionContext } from "./helpers";

// hit_test — click-through polling and the silhouette alpha cut.
export function validateHitTest(
  raw: Record<string, unknown>,
  ctx: SectionContext,
): Partial<HitTestKnobs> {
  const { issues } = ctx;
  const hit_test: Partial<HitTestKnobs> = {};
  const rawHitTest = raw.hit_test;
  if (!isObject(rawHitTest)) {
    issues.push(`hit_test must be an object (got: ${JSON.stringify(rawHitTest)})`);
  } else {
    hit_test.hysteresis_margin_px = num(
      issues,
      rawHitTest,
      "hit_test",
      "hysteresis_margin_px",
      nonNegative,
      "a finite number >= 0",
    );
    hit_test.poll_interval_ms = num(
      issues,
      rawHitTest,
      "hit_test",
      "poll_interval_ms",
      positive,
      "a finite number > 0",
    );
    hit_test.debounce_samples = int(
      issues,
      rawHitTest,
      "hit_test",
      "debounce_samples",
      (v) => v >= 1,
      "an integer >= 1",
    );
    hit_test.alpha_threshold = num(
      issues,
      rawHitTest,
      "hit_test",
      "alpha_threshold",
      (v) => v > 0 && v <= 1,
      "a finite number in (0, 1]",
    );
  }
  return hit_test;
}
