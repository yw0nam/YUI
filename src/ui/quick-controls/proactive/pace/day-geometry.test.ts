import { describe, expect, it } from "vitest";
import { checkinLadder, paceRuns } from "./day-geometry";

describe("paceRuns", () => {
  it.each([
    ["no spans", [], [{ start: 0, end: 1440, pace: "normal" }]],
    [
      "one afternoon span",
      [{ start: "09:00", end: "18:00", pace: "low" }],
      [
        { start: 0, end: 540, pace: "normal" },
        { start: 540, end: 1080, pace: "low" },
        { start: 1080, end: 1440, pace: "normal" },
      ],
    ],
    [
      "a span past midnight",
      [{ start: "22:00", end: "06:00", pace: "off" }],
      [
        { start: 0, end: 360, pace: "off" },
        { start: 360, end: 1320, pace: "normal" },
        { start: 1320, end: 1440, pace: "off" },
      ],
    ],
    [
      "a span with equal bounds",
      [{ start: "08:00", end: "08:00", pace: "high" }],
      [{ start: 0, end: 1440, pace: "high" }],
    ],
    [
      "a span inside another",
      [
        { start: "09:00", end: "18:00", pace: "low" },
        { start: "12:00", end: "14:00", pace: "high" },
      ],
      [
        { start: 0, end: 540, pace: "normal" },
        { start: 540, end: 720, pace: "low" },
        { start: 720, end: 840, pace: "high" },
        { start: 840, end: 1080, pace: "low" },
        { start: 1080, end: 1440, pace: "normal" },
      ],
    ],
  ] as const)("cuts the day into runs of one pace: %s", (_name, spans, runs) => {
    expect(paceRuns(spans)).toEqual(runs);
  });
});

describe("checkinLadder", () => {
  it.each([
    [[5, 10, 30], "normal", { end: 120, marks: [5, 10, 30] }],
    [[5, 10, 30], "low", { end: 120, marks: [15, 30, 90] }],
    [[5, 10, 30], "high", { end: 120, marks: [2.5, 5, 15] }],
    [[60], "normal", { end: 180, marks: [60] }],
    [[], "normal", { end: 120, marks: [] }],
  ] as const)("spaces check-ins %j at the %s pace", (idleMins, pace, ladder) => {
    expect(checkinLadder(idleMins, pace)).toEqual(ladder);
  });
});
