import { describe, expect, it, vi } from "vitest";
import type { BusEnvelope, EventBus } from "../dispatcher/event-bus";
import { createTapSource, type TapConfig, type TapPoints } from "./tap-source";

const config: TapConfig = {
  spam_count: 4,
  spam_window_ms: 3_000,
  region_radius_frac: 0.18,
  region_motions: { chest: "shy", hips: "flustered" },
  bored_cue: {
    label: "wants attention",
    context: "The user is poking repeatedly.",
  },
};

function harness(
  points: TapPoints | null = null,
  drainSignals: (() => Array<Record<string, unknown>>) | undefined = undefined,
) {
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
  const source = createTapSource({ bus, ambient, renderer, config, now: () => time, drainSignals });
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

  it("fires one bored candidate without a motion event, clears the streak, and makes the fifth click plain", () => {
    const { source, pushed, ambient, setTime } = harness(null);
    for (const time of [1_000, 1_500, 2_000, 2_500, 2_600]) {
      setTime(time);
      source.handleClick({ x: 1, y: 2 });
    }

    expect(pushed.filter((env) => env.event_name === "proactive.tap_bored")).toEqual([
      {
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        ts: 2_500,
        hint_tier: 2,
        payload: {
          cue_id: "tap_bored",
          label: "wants attention",
          context: "The user is poking repeatedly.",
        },
      },
    ]);
    expect(pushed.at(-1)?.event_name).toBe("user.tap");
    expect(ambient.trigger).toHaveBeenCalledTimes(4);
  });

  it("expires a click exactly at the window boundary and never fires bored for spaced clicks", () => {
    const { source, pushed, setTime } = harness(null);
    for (const time of [0, 3_000, 6_000, 9_000, 12_000]) {
      setTime(time);
      source.handleClick({ x: 1, y: 2 });
    }
    expect(pushed.some((env) => env.event_name === "proactive.tap_bored")).toBe(false);
  });

  it("keeps the region reaction, suppresses bored, and resets when a region tap completes the streak", () => {
    const drainSignals = vi.fn(() => [{ id: "buffered" }]);
    const { source, pushed, ambient, setTime } = harness(
      {
        chest: { x: 1, y: 2 },
        hips: null,
        charHpx: 200,
      },
      drainSignals,
    );
    for (const time of [1_000, 1_100, 1_200]) {
      setTime(time);
      source.handleClick({ x: 100, y: 100 });
    }
    setTime(1_300);
    source.handleClick({ x: 1, y: 2 });
    setTime(1_400);
    source.handleClick({ x: 100, y: 100 });

    expect(pushed.filter((env) => env.event_name === "user.tap_region")).toHaveLength(1);
    expect(pushed.filter((env) => env.event_name === "proactive.tap_bored")).toHaveLength(0);
    expect(ambient.trigger).toHaveBeenCalledTimes(4);
    expect(drainSignals).not.toHaveBeenCalled();
  });

  it("adds drained signals only when non-empty and drains only on the firing click", () => {
    const drainSignals = vi.fn(() => [{ kind: "calendar", title: "Meeting soon" }]);
    const { source, pushed, setTime } = harness(null, drainSignals);

    for (const time of [1_000, 1_100, 1_200, 1_300]) {
      setTime(time);
      source.handleClick({ x: 1, y: 2 });
    }

    expect(drainSignals).toHaveBeenCalledOnce();
    expect(pushed.at(-1)?.payload).toEqual({
      cue_id: "tap_bored",
      label: "wants attention",
      context: "The user is poking repeatedly.",
      signals: [{ kind: "calendar", title: "Meeting soon" }],
    });
  });

  it("omits signals when the firing-click drain is empty", () => {
    const drainSignals = vi.fn(() => []);
    const { source, pushed, setTime } = harness(null, drainSignals);

    for (const time of [1_000, 1_100, 1_200, 1_300]) {
      setTime(time);
      source.handleClick({ x: 1, y: 2 });
    }

    expect(drainSignals).toHaveBeenCalledOnce();
    expect(pushed.at(-1)?.payload).not.toHaveProperty("signals");
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
