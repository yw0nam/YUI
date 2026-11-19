/**
 * spans.test.ts — active-hours span rules.
 *
 * Pins paceAt: midnight-wrapped spans, the uncovered default, the nested-span
 * winner and its start tie, and the whole-day span; and wrapsMidnight, which
 * holds only for a span whose end comes before its start.
 */

import { describe, expect, it } from "vitest";
import { paceAt, type Span, wrapsMidnight } from "./spans";

const YUI_SPANS: Span[] = [
  { start: "08:00", end: "12:00", pace: "low" },
  { start: "12:00", end: "22:00", pace: "normal" },
  { start: "22:00", end: "03:00", pace: "high" },
];

describe("paceAt", () => {
  it("reads Yui's wrapped span as high at 23:30 and 02:00 and normal at 03:00", () => {
    expect(paceAt(YUI_SPANS, 23 * 60 + 30)).toBe("high");
    expect(paceAt(YUI_SPANS, 2 * 60)).toBe("high");
    expect(paceAt(YUI_SPANS, 3 * 60)).toBe("normal");
  });

  it("reads an uncovered minute as normal", () => {
    expect(paceAt(YUI_SPANS, 6 * 60 + 30)).toBe("normal");
  });

  it.each<[string, Span[], [number, string], [number, string]]>([
    [
      "same day",
      [
        { start: "12:00", end: "22:00", pace: "normal" },
        { start: "18:00", end: "20:00", pace: "off" },
      ],
      [19 * 60, "off"],
      [21 * 60, "normal"],
    ],
    [
      "across midnight",
      [
        { start: "22:00", end: "03:00", pace: "high" },
        { start: "01:00", end: "02:00", pace: "off" },
      ],
      [1 * 60 + 30, "off"],
      [2 * 60 + 30, "high"],
    ],
  ])("gives a nested span the minute it starts shorter before: $0", (_label, spans, inside, outside) => {
    expect(paceAt(spans, inside[0])).toBe(inside[1]);
    expect(paceAt(spans, outside[0])).toBe(outside[1]);
  });

  it("breaks a start tie by the later span in the list", () => {
    expect(
      paceAt(
        [
          { start: "08:00", end: "12:00", pace: "low" },
          { start: "08:00", end: "10:00", pace: "off" },
        ],
        9 * 60,
      ),
    ).toBe("off");
    expect(
      paceAt(
        [
          { start: "08:00", end: "10:00", pace: "off" },
          { start: "08:00", end: "12:00", pace: "low" },
        ],
        9 * 60,
      ),
    ).toBe("low");
  });

  it("covers the whole day when start equals end", () => {
    const wholeDay: Span[] = [{ start: "00:00", end: "00:00", pace: "low" }];
    for (let minute = 0; minute < 1440; minute += 60) {
      expect(paceAt(wholeDay, minute)).toBe("low");
    }
  });
});

describe("wrapsMidnight", () => {
  it.each<[string, Span, boolean]>([
    ["end before start", { start: "22:00", end: "03:00", pace: "normal" }, true],
    ["end after start", { start: "08:00", end: "12:00", pace: "normal" }, false],
    ["end equal to start", { start: "08:00", end: "08:00", pace: "normal" }, false],
  ])("wraps only when the end comes before the start: $0", (_label, span, wraps) => {
    expect(wrapsMidnight(span)).toBe(wraps);
  });
});
