import { describe, expect, it } from "vitest";
import { mentionOf, sendIdOf } from "./classify";

const env = (payload: Record<string, unknown> | undefined) => ({ payload });

describe("sendIdOf", () => {
  it.each([
    [{ send_id: "s1" }, "s1"],
    [{ send_id: 7 }, undefined],
    [{}, undefined],
    [undefined, undefined],
  ])("reads %j as %j", (payload, expected) => {
    expect(sendIdOf(env(payload))).toBe(expected);
  });
});

describe("mentionOf", () => {
  it.each([
    [{ mention: "character" }, "character"],
    [{ mention: "everyone" }, "everyone"],
    [{ mention: "all" }, undefined],
    [{ mention: true }, undefined],
    [undefined, undefined],
  ])("reads %j as %j", (payload, expected) => {
    expect(mentionOf(env(payload))).toBe(expected);
  });
});
