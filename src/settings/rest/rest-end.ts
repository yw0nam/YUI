/** When a Rest choice ends, by the local wall clock, and how much of it is left. */

import { REST_CHOICES, type RestChoice } from "./rest-choices";

/** The hour Until tomorrow morning ends at; before it, Until tonight is not offered. */
const MORNING_HOUR = 8;
export const MIN_MS = 60_000;

/** The end of `choice` started at `now`; Until I turn it off has none. */
export function restEndsAt(choice: RestChoice, now: number): number | undefined {
  const d = new Date(now);
  switch (choice) {
    case "hour":
      return now + 60 * MIN_MS;
    case "focus_25":
      return now + 25 * MIN_MS;
    case "focus_50":
      return now + 50 * MIN_MS;
    case "tonight":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    case "morning": {
      const day = d.getDate() + (d.getHours() < MORNING_HOUR ? 0 : 1);
      return new Date(d.getFullYear(), d.getMonth(), day, MORNING_HOUR).getTime();
    }
    case "until_off":
      return undefined;
  }
}

/** The choices offered at `now`: after midnight Until tonight is gone. */
export function restChoicesAt(now: number): RestChoice[] {
  const early = new Date(now).getHours() < MORNING_HOUR;
  return REST_CHOICES.filter((c) => !(early && c === "tonight"));
}

/** Whole minutes left before `endsAt`, rounded up, so a fresh Focus 25 reads 25. */
export const minutesLeft = (endsAt: number, now: number): number =>
  Math.ceil((endsAt - now) / MIN_MS);

/** The local wall-clock time of `ms` as HH:MM. */
export function clockOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
