/** What holds her own turns at an instant, from the Rest record and the off spans, and when that can next change. */

import { minutesOffFrom, type Span } from "../active-hours/spans";
import { isFocusChoice, type RestState } from "./rest-choices";
import { MIN_MS, minutesLeft, restChoicesAt } from "./rest-end";
import type { RunningRest } from "./rest-settings";

/** A running Rest or Focus, else an off span covering `now` with the minute it ends, else null. */
export function restAt(
  running: RunningRest | null,
  spans: readonly Span[],
  now: number,
): RestState | null {
  if (running) return { kind: isFocusChoice(running.choice) ? "focus" : "rest", ...running };
  const at = new Date(now);
  const ahead = minutesOffFrom(spans, at.getHours() * 60 + at.getMinutes());
  if (ahead === 0) return null;
  if (ahead === null) return { kind: "quiet" };
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours());
  end.setMinutes(at.getMinutes() + ahead);
  return { kind: "quiet", endsAt: end.getTime() };
}

/** The next instant anything drawn can change: the minute boundary, a Rest's end, or a Focus minute. */
export function restWakeAt(running: RunningRest | null, now: number): number {
  const d = new Date(now);
  let next = now + MIN_MS - (d.getSeconds() * 1000 + d.getMilliseconds());
  if (running?.endsAt !== undefined) next = Math.min(next, running.endsAt);
  if (running && isFocusChoice(running.choice) && running.startedAt !== undefined) {
    const elapsed = Math.floor((now - running.startedAt) / MIN_MS) + 1;
    next = Math.min(next, running.startedAt + elapsed * MIN_MS);
  }
  return next;
}

/** What the Rest surfaces draw at `now`; a change of it is a notification. */
export function restDrawnKey(state: RestState | null, now: number): string {
  const left = state?.kind === "focus" && state.endsAt ? minutesLeft(state.endsAt, now) : "";
  return [state?.kind, state?.choice, state?.endsAt, left, restChoicesAt(now).length].join("|");
}
