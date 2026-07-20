import { describe, expect, it, vi } from "vitest";
import type { BusEnvelope, EventBus } from "../dispatcher/event-bus";
import { createTapSource, type TapConfig, type TapPoints } from "./tap-source";

const config: TapConfig = {
  spam_count: 4,
  spam_window_ms: 3_000,
  region_radius_frac: 0.18,
  region_motions: { chest: "shy", hips: "flustered" },
  spam_motion: "sulk",
};

function harness(points: TapPoints | null = null) {
  const pushed: BusEnvelope[] = [];
  const bus = {
    push: vi.fn((env: BusEnvelope) => {
      pushed.push(env);
      return true;
    }),
  } as Pick<EventBus, "push">;
  const ambient = { trigger: vi.fn() };
  const renderer = { getTapPoints: vi.fn(() => points) };
  let time = 1_000;
  const source = createTapSource({ bus, ambient, renderer, config, now: () => time });
  return { source, pushed, ambient, renderer, setTime: (next: number) => (time = next) };
}

describe("createTapSource", () => {
  it("turns a plain tap into the local cue and an observable user.tap envelope", () => {
    const { source, pushed, ambient } = harness(null);
    source.handleClick({ x: 12, y: 34 });

    expect(ambient.trigger).toHaveBeenCalledOnce();
    expect(ambient.trigger).toHaveBeenCalledWith("tap_react");
    expect(pushed).toEqual([
      {
        source: "os_event_watcher",
        event_name: "user.tap",
        ts: 1_000,
        hint_tier: 1,
        dnd_override: true,
      },
    ]);
  });

  it("maps a region hit to its configured motion without playing the plain cue", () => {
    const { source, pushed, ambient } = harness({
      chest: { x: 50, y: 60 },
      hips: { x: 50, y: 120 },
      charHpx: 200,
    });
    source.handleClick({ x: 52, y: 61 });

    expect(ambient.trigger).not.toHaveBeenCalled();
    expect(pushed).toEqual([
      {
        source: "os_event_watcher",
        event_name: "user.tap_region",
        ts: 1_000,
        hint_tier: 1,
        dnd_override: true,
        payload: { motion_id: "shy" },
      },
    ]);
  });

  it("fires one local and one proactive spam event, clears the streak, and makes the fifth click plain", () => {
    const { source, pushed, ambient, setTime } = harness(null);
    for (const time of [1_000, 1_500, 2_000, 2_500, 2_600]) {
      setTime(time);
      source.handleClick({ x: 1, y: 2 });
    }

    expect(pushed.filter((env) => env.event_name === "user.tap_spam")).toEqual([
      {
        source: "os_event_watcher",
        event_name: "user.tap_spam",
        ts: 2_500,
        hint_tier: 1,
        dnd_override: true,
        payload: { motion_id: "sulk" },
      },
    ]);
    expect(pushed.filter((env) => env.event_name === "proactive.tap_spam")).toEqual([
      {
        source: "os_event_watcher",
        event_name: "proactive.tap_spam",
        ts: 2_500,
        hint_tier: 2,
        payload: { count: 4, window_ms: 3_000 },
      },
    ]);
    expect(pushed.at(-1)?.event_name).toBe("user.tap");
    expect(ambient.trigger).toHaveBeenCalledTimes(4);
  });

  it("expires a click exactly at the window boundary and never spams spaced clicks", () => {
    const { source, pushed, setTime } = harness(null);
    for (const time of [0, 3_000, 6_000, 9_000, 12_000]) {
      setTime(time);
      source.handleClick({ x: 1, y: 2 });
    }
    expect(pushed.some((env) => env.event_name.endsWith("tap_spam"))).toBe(false);
  });

  it("does not also emit a region or bob reaction for the spam-completing click", () => {
    const { source, pushed, ambient, setTime } = harness({
      chest: { x: 1, y: 2 },
      hips: null,
      charHpx: 200,
    });
    for (const time of [1_000, 1_100, 1_200, 1_300]) {
      setTime(time);
      source.handleClick({ x: 1, y: 2 });
    }

    expect(pushed.filter((env) => env.event_name === "user.tap_region")).toHaveLength(3);
    expect(pushed.filter((env) => env.event_name === "user.tap_spam")).toHaveLength(1);
    expect(ambient.trigger).not.toHaveBeenCalled();
  });

  it("degrades malformed renderer results to a plain tap without throwing", () => {
    const { source, pushed, ambient } = harness({
      chest: { x: 0, y: 0 },
      hips: null,
      charHpx: Number.NaN,
    });
    expect(() => source.handleClick({ x: 0, y: 0 })).not.toThrow();
    expect(ambient.trigger).toHaveBeenCalledOnce();
    expect(pushed[0]?.event_name).toBe("user.tap");
  });
});
