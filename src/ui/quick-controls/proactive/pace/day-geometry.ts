import type { BasePace } from "../../../../settings/active-hours/base-pace-settings";
import type { Pace, Span } from "../../../../settings/active-hours/spans";

export function paceRuns(_spans: readonly Span[]): { start: number; end: number; pace: Pace }[] {
  return [];
}

export function checkinLadder(
  _idleMins: readonly number[],
  _pace: BasePace,
): { end: number; marks: number[] } {
  return { end: 0, marks: [] };
}
