/** Stub for the red run: paceAt answers nothing yet. */

export type Pace = "high" | "normal" | "low" | "off";

export interface Span {
  start: string;
  end: string;
  pace: Pace;
}

export function paceAt(_spans: readonly Span[], _minute: number): Pace {
  return undefined as unknown as Pace;
}
