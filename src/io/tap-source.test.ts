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
  touch_cue_cooldown_ms: 60_000,
  touch_emotion_hold_ms: 4_000,
};

function harness(
  points: TapPoints | null = null,
  drainSignals: (() => Array<Record<string, unknown>>) | undefined = undefined,
  currentMotion:
    | { id: string; vrma_path: string }
    | null
    | (() => { id: string; vrma_path: string } | null) = null,
  configOverride: TapConfig = config,
) {
  const pushed: BusEnvelope[] = [];
  const bus = {
    push: vi.fn((env: BusEnvelope) => {
      pushed.push(env);
      return true;
    }),
  } as Pick<EventBus, "push">;
  const ambient = { trigger: vi.fn() };
  const renderer = {
    getTapPoints: vi.fn(() => points),
    getCurrentMotion: vi.fn(() =>
      typeof currentMotion === "function" ? currentMotion() : currentMotion,
    ),
  };
  let time = 1_000;
  const source = createTapSource({
    bus,
    ambient,
    renderer,
    config: configOverride,
    now: () => time,
    drainSignals,
  });
  return { source, pushed, ambient, renderer, setTime: (next: number) => (time = next) };
}

function bothRegionsPoints(): TapPoints {
  return { chest: { x: 50, y: 60 }, hips: { x: 50, y: 120 }, charHpx: 200 };
}

function touchConfig(): TapConfig {
  return {
    ...config,
    region_cues: {
      chest: { label: "chest poked", context: "The user just poked my chest." },
      hips: { label: "butt poked", context: "The user just poked my butt." },
    },
  };
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

  it("suppresses a region tap while its mapped motion is already playing", () => {
    const { source, pushed, ambient } = harness(
      {
        chest: { x: 50, y: 60 },
        hips: null,
        charHpx: 200,
      },
      undefined,
      { id: "shy", vrma_path: "/motions/shy.vrma" },
    );

    source.handleClick({ x: 50, y: 60 });

    expect(pushed).toEqual([]);
    expect(ambient.trigger).not.toHaveBeenCalled();
  });

  it("fires a region tap while a different motion is playing", () => {
    const { source, pushed } = harness(
      {
        chest: { x: 50, y: 60 },
        hips: null,
        charHpx: 200,
      },
      undefined,
      { id: "wave", vrma_path: "/motions/wave.vrma" },
    );

    source.handleClick({ x: 50, y: 60 });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.event_name).toBe("user.tap_region");
  });

  it("fires a region tap when no motion is playing", () => {
    const { source, pushed } = harness({
      chest: { x: 50, y: 60 },
      hips: null,
      charHpx: 200,
    });

    source.handleClick({ x: 50, y: 60 });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.event_name).toBe("user.tap_region");
  });

  it("fires a region tap when reading the current motion fails", () => {
    const { source, pushed } = harness(
      {
        chest: { x: 50, y: 60 },
        hips: null,
        charHpx: 200,
      },
      undefined,
      () => {
        throw new Error("renderer unavailable");
      },
    );

    expect(() => source.handleClick({ x: 50, y: 60 })).not.toThrow();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.event_name).toBe("user.tap_region");
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

  it("suppresses a repeated region reaction and bored, then resets when that tap completes the streak", () => {
    const drainSignals = vi.fn(() => [{ id: "buffered" }]);
    const { source, pushed, ambient, setTime } = harness(
      {
        chest: { x: 1, y: 2 },
        hips: null,
        charHpx: 200,
      },
      drainSignals,
      { id: "shy", vrma_path: "/motions/shy.vrma" },
    );
    for (const time of [1_000, 1_100, 1_200]) {
      setTime(time);
      source.handleClick({ x: 100, y: 100 });
    }
    setTime(1_300);
    source.handleClick({ x: 1, y: 2 });
    for (const time of [1_400, 1_500, 1_600, 1_700]) {
      setTime(time);
      source.handleClick({ x: 100, y: 100 });
    }

    expect(pushed.filter((env) => env.event_name === "user.tap_region")).toHaveLength(0);
    expect(pushed.filter((env) => env.event_name === "proactive.tap_bored")).toHaveLength(1);
    expect(pushed.at(-1)?.ts).toBe(1_700);
    expect(ambient.trigger).toHaveBeenCalledTimes(6);
    expect(drainSignals).toHaveBeenCalledOnce();
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

  it("fires one tier2 touch candidate alongside the tier1 region push", () => {
    const { source, pushed } = harness(bothRegionsPoints(), undefined, null, touchConfig());
    source.handleClick({ x: 50, y: 60 });

    expect(pushed).toEqual([
      {
        source: "os_event_watcher",
        event_name: "proactive.touch_chest",
        ts: 1_000,
        hint_tier: 2,
        payload: {
          cue_id: "touch_chest",
          label: "chest poked",
          context: "The user just poked my chest.",
        },
      },
      {
        source: "os_event_watcher",
        event_name: "user.tap_region",
        ts: 1_000,
        hint_tier: 1,
        dnd_override: true,
        payload: { motion_id: "shy" },
      },
    ]);
    expect(pushed[0]).not.toHaveProperty("dnd_override");
  });

  it("suppresses the touch candidate within the cooldown and fires again after it elapses", () => {
    const { source, pushed, setTime } = harness(
      bothRegionsPoints(),
      undefined,
      null,
      touchConfig(),
    );
    const touches = () => pushed.filter((env) => env.event_name === "proactive.touch_chest");

    source.handleClick({ x: 50, y: 60 });
    setTime(2_000);
    source.handleClick({ x: 50, y: 60 });

    expect(touches()).toHaveLength(1);
    expect(pushed.filter((env) => env.event_name === "user.tap_region")).toHaveLength(2);

    setTime(61_000);
    source.handleClick({ x: 50, y: 60 });
    expect(touches()).toHaveLength(2);
    expect(touches().at(-1)?.ts).toBe(61_000);
  });

  it("shares one cooldown across regions", () => {
    const { source, pushed, setTime } = harness(
      bothRegionsPoints(),
      undefined,
      null,
      touchConfig(),
    );

    source.handleClick({ x: 50, y: 60 });
    setTime(2_000);
    source.handleClick({ x: 50, y: 120 });

    expect(pushed.filter((env) => env.event_name.startsWith("proactive.touch_"))).toEqual([
      expect.objectContaining({ event_name: "proactive.touch_chest" }),
    ]);
    expect(pushed.at(-1)?.payload).toEqual({ motion_id: "flustered" });
  });

  it("pushes no touch candidate when region_cues is absent", () => {
    const { source, pushed } = harness(bothRegionsPoints());
    source.handleClick({ x: 50, y: 60 });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.event_name).toBe("user.tap_region");
  });

  it("still fires the touch candidate when the mapped motion is already playing", () => {
    const { source, pushed } = harness(
      bothRegionsPoints(),
      undefined,
      { id: "shy", vrma_path: "/motions/shy.vrma" },
      touchConfig(),
    );
    source.handleClick({ x: 50, y: 60 });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.event_name).toBe("proactive.touch_chest");
  });

  it("adds emotion_id to the tier1 payload when region_emotions is configured", () => {
    const { source, pushed } = harness(bothRegionsPoints(), undefined, null, {
      ...config,
      region_emotions: { chest: "embarrassed" },
    });
    source.handleClick({ x: 50, y: 60 });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.payload).toEqual({ motion_id: "shy", emotion_id: "embarrassed" });
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
