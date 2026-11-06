import { describe, expect, it } from "vitest";
import { findMethodTimerCalls } from "../../scripts/ci/detached-timers.mjs";

describe("detached-timers check", () => {
  it.each([
    ["timer = deps.setInterval(() => {}, 16);", "deps.setInterval("],
    ["deps.clearInterval?.(timer);", "deps.clearInterval?.("],
    ["deps.setTimeout!(f);", "deps.setTimeout!("],
    ["deps!.setTimeout(f);", "deps!.setTimeout("],
    ["this.setTimeout(f);", "this.setTimeout("],
  ])("flags %s", (text, call) => {
    expect(findMethodTimerCalls(text)).toEqual([{ line: 1, call }]);
  });

  it("flags a call split across lines on the line of its object", () => {
    expect(findMethodTimerCalls("const a = 1;\ndeps\n  .setInterval(f);")).toEqual([
      { line: 2, call: "deps .setInterval(" },
    ]);
  });

  it.each([
    "const id = setInterval(f, 16);",
    "window.setTimeout(f);",
    "globalThis.clearTimeout(id);",
    "const setIntervalImpl = deps.setInterval;",
  ])("passes %s", (text) => {
    expect(findMethodTimerCalls(text)).toEqual([]);
  });
});
