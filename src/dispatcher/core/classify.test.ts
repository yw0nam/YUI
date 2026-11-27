import { describe, expect, it } from "vitest";
import { isUserActivity, mentionOf, sendIdOf, waitClassOf } from "./classify";

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

describe("waitClassOf", () => {
  it.each([
    ["os_event_watcher", "proactive.touch_face", "now"],
    ["os_event_watcher", "time_milestone.first_activity", "now"],
    ["addressed_source", "addressed.character", "now"],
    ["timer_scheduler", "schedule.lunch", "scheduled"],
    ["timer_scheduler", "proactive.touch_face", "room"],
    ["screen_watcher", "proactive.screen_app_switched", "room"],
  ] as const)("ranks %s %s as %s", (source, event_name, expected) => {
    expect(waitClassOf({ source, event_name, ts: 0 })).toBe(expected);
  });
});

describe("isUserActivity", () => {
  it.each([
    ["user_input_source", "user.text_submitted", true],
    ["user_input_source", "user.voice_segment_ready", true],
    ["os_event_watcher", "user.tap", true],
    ["os_event_watcher", "user.tap_region", true],
    ["os_event_watcher", "user.pat_start", true],
    ["os_event_watcher", "user.drag_start", true],
    ["os_event_watcher", "user.drag_end", false],
    ["os_event_watcher", "proactive.touch_face", false],
    ["timer_scheduler", "proactive.idle_long", false],
  ] as const)("reads %s %s as %s", (source, event_name, expected) => {
    expect(isUserActivity({ source, event_name, ts: 0 })).toBe(expected);
  });
});
