/**
 * spans.test.ts — active-hours span rules.
 *
 * Pins paceAt: midnight-wrapped spans, the uncovered default, the nested-span
 * winner, and the whole-day span.
 */

import { describe, expect, it } from "vitest";
import { paceAt, type Span } from "./spans";

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

  it("gives a nested span the minute it starts shorter before", () => {
    const nested: Span[] = [
      { start: "12:00", end: "22:00", pace: "normal" },
      { start: "18:00", end: "20:00", pace: "off" },
    ];
    expect(paceAt(nested, 19 * 60)).toBe("off");
    expect(paceAt(nested, 21 * 60)).toBe("normal");
  });

  it("gives a nested span the minute it starts shorter before across midnight", () => {
    const nested: Span[] = [
      { start: "22:00", end: "03:00", pace: "high" },
      { start: "01:00", end: "02:00", pace: "off" },
    ];
    expect(paceAt(nested, 1 * 60 + 30)).toBe("off");
    expect(paceAt(nested, 2 * 60 + 30)).toBe("high");
  });

  it("covers the whole day when start equals end", () => {
    const wholeDay: Span[] = [{ start: "00:00", end: "00:00", pace: "low" }];
    for (let minute = 0; minute < 1440; minute += 60) {
      expect(paceAt(wholeDay, minute)).toBe("low");
    }
  });
});
