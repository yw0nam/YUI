/** Her day as geometry: the pace runs across 24 hours, and where the check-ins after quiet fall. */

import type { BasePace } from "../../../../settings/active-hours/base-pace-settings";
import {
  PACE_FACTOR,
  type Pace,
  paceAt,
  type Span,
  toMinutes,
} from "../../../../settings/active-hours/spans";

/** The day from minute 0 to 1440 as consecutive runs of one pace; an uncovered minute is normal, so it is never empty. */
export function paceRuns(spans: readonly Span[]): { start: number; end: number; pace: Pace }[] {
  const cuts = [
    ...new Set([0, 1440, ...spans.flatMap((s) => [toMinutes(s.start), toMinutes(s.end)])]),
  ].sort((a, b) => a - b);
  const runs: { start: number; end: number; pace: Pace }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const pace = paceAt(spans, cuts[i]);
    const last = runs.at(-1);
    if (last?.pace === pace) last.end = cuts[i + 1];
    else runs.push({ start: cuts[i], end: cuts[i + 1], pace });
  }
  return runs;
}

/** The check-ins at `pace`, on an axis that ends past the slowest pace's last one, so only the marks move. */
export function checkinLadder(
  idleMins: readonly number[],
  pace: BasePace,
): { end: number; marks: number[] } {
  const slowest = Math.max(0, ...idleMins) * PACE_FACTOR.low;
  return {
    end: Math.max(120, Math.ceil(slowest / 30) * 30),
    marks: idleMins.map((min) => min * PACE_FACTOR[pace]),
  };
}
