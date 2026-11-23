/**
 * Active-hours span rules: one span scales how often a character may start a
 * conversation on her own while it holds, and which span wins when two cover a minute.
 */

/** The paces a span may hold, in UI order. */
export const PACES = ["high", "normal", "low", "off"] as const;
export type Pace = (typeof PACES)[number];

/** Multiplies the device-wide proactive gap while the span holds; `off` holds the triggers and scales nothing. */
export const PACE_FACTOR: Record<Exclude<Pace, "off">, number> = { high: 0.5, normal: 1, low: 3 };

/** One active-hours span; end before start wraps midnight, equal bounds cover the whole day. */
export interface Span {
  start: string;
  end: string;
  pace: Pace;
}

/** The HH:MM 24-hour shape every span time and every active-hours time input holds. */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isSpan(v: unknown): v is Span {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.start === "string" &&
    TIME_RE.test(s.start) &&
    typeof s.end === "string" &&
    TIME_RE.test(s.end) &&
    typeof s.pace === "string" &&
    (PACES as readonly string[]).includes(s.pace)
  );
}

/** True when `v` is an array whose every entry holds a valid start, end and pace. */
export function isValidSpans(v: unknown): v is Span[] {
  return Array.isArray(v) && v.every(isSpan);
}

/** The minute of the day an HH:MM time names. */
export const toMinutes = (time: string): number =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** True when the span's end comes before its start, so it runs past midnight. */
export function wrapsMidnight(span: Pick<Span, "start" | "end">): boolean {
  return toMinutes(span.end) < toMinutes(span.start);
}

function covers(s: Span, t: number): boolean {
  const start = toMinutes(s.start);
  const end = toMinutes(s.end);
  return start < end ? start <= t && t < end : start > end ? t >= start || t < end : true;
}

/** The pace at `minute` (minute of day 0..1439): the covering span that starts shortest before it, the later one on a tie; normal uncovered. */
export function paceAt(spans: readonly Span[], minute: number): Pace {
  let pace: Pace | undefined;
  let shortest = Number.POSITIVE_INFINITY;
  for (const s of spans) {
    if (!covers(s, minute)) continue;
    const before = (minute - toMinutes(s.start) + 1440) % 1440;
    if (before <= shortest) {
      shortest = before;
      pace = s.pace;
    }
  }
  return pace ?? "normal";
}
