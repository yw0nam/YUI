/** rest-end.test.ts — when each Rest choice ends, by the local wall clock. */

const previousTz = process.env.TZ;
process.env.TZ = "America/New_York";

import { afterAll, expect, it } from "vitest";
import type { RestChoice } from "./rest-choices";
import { restEndsAt } from "./rest-end";

afterAll(() => {
  process.env.TZ = previousTz;
});

// Wall-clock instants in America/New_York (EST is UTC-5 in November).
const nov = (d: number, h: number, m: number) => Date.UTC(2026, 10, d, h + 5, m);

it.each([
  ["hour", "21:10", nov(26, 21, 10), nov(26, 22, 10)],
  ["tonight", "21:10", nov(26, 21, 10), nov(27, 0, 0)],
  ["morning", "21:10", nov(26, 21, 10), nov(27, 8, 0)],
  ["tonight", "23:59", nov(26, 23, 59), nov(27, 0, 0)],
  ["morning", "23:59", nov(26, 23, 59), nov(27, 8, 0)],
  ["morning", "00:30", nov(27, 0, 30), nov(27, 8, 0)],
  ["morning", "07:59", nov(27, 7, 59), nov(27, 8, 0)],
  ["focus_25", "21:10", nov(26, 21, 10), nov(26, 21, 35)],
  ["focus_50", "21:10", nov(26, 21, 10), nov(26, 22, 0)],
  // 2026-03-08: 02:00 EST jumps to 03:00 EDT.
  [
    "morning",
    "21:10 before the spring change",
    Date.UTC(2026, 2, 8, 2, 10),
    Date.UTC(2026, 2, 8, 12, 0),
  ],
  ["hour", "01:30 on the spring change", Date.UTC(2026, 2, 8, 6, 30), Date.UTC(2026, 2, 8, 7, 30)],
] as const)("%s started at %s ends at the expected instant", (choice, _clock, now, expected) => {
  expect(restEndsAt(choice as RestChoice, now)).toBe(expected);
});
