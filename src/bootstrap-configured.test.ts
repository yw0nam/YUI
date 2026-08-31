import { describe, expect, it, vi } from "vitest";
import {
  type ConfiguredBootstrapFactories,
  createConfiguredBootstrap,
  createPatGesture,
  createSitLossFall,
} from "./bootstrap-configured";
import { type AppConfig, ATTACHMENT_LIMITS_DEFAULTS } from "./config";

function validConfig(): AppConfig {
  return {
    endpoints: {
      chat_base_url: "http://chat.test/v1",
      chat_endpoint: "/responses",
      stt_base_url: "http://stt.test/v1",
      tts_base_url: "http://tts.test/v1",
    },
    avatar: {
      vrm_url: "/vrms/test.vrm",
      available: [{ id: "test", label: "Test", url: "/vrms/test.vrm" }],
      tap: {
        spam_count: 4,
        spam_window_ms: 3_000,
        region_radius_frac: 0.18,
        region_motions: { head: "head_pat", chest: "embarrassed", hips: "embarrassed" },
        bored_cue: { label: "bored poking" },
        touch_cue_cooldown_ms: 60_000,
        touch_emotion_hold_ms: 4_000,
        pat_hold_ms: 300,
      },
      peek: {
        side_out_frac: 0.28,
        side_in_frac: 0.23,
        inset_frac: 0.12,
        mirror_side: "right",
      },
      walk: {
        interval_min_ms: 60_000,
        interval_max_ms: 180_000,
        distance_min_px: 80,
        distance_max_px: 320,
        floor_tolerance_px: 8,
      },
      perch_walk: {
        dwell_min_ms: 45_000,
        dwell_max_ms: 120_000,
        distance_min_px: 80,
        distance_max_px: 400,
        edge_margin_frac: 0.2,
      },
      fall: {
        gravity_px_s2: 2400,
        max_speed_px_s: 1800,
        min_drop_frac: 0.2,
        cue_cooldown_ms: 60_000,
      },
      climb: {
        interval_min_ms: 90_000,
        interval_max_ms: 180_000,
        perch_dwell_min_ms: 60_000,
        perch_dwell_max_ms: 120_000,
        max_height_frac: 4,
        hang_frac: 0.3,
        wall_offset_frac: 0.3,
        ledge_walk_min_frac: 0.5,
        ledge_walk_max_frac: 1.5,
      },
      jump: {
        probability: 0.3,
        height_up_max_frac: 0.5,
        height_down_max_frac: 1,
        gap_max_width_frac: 1.5,
        apex_lift_frac: 0.15,
        takeoff_frac: 0.4,
        land_frac: 0.67,
        flight_timeout_ms: 4000,
      },
      drag_hold_ms: 5_000,
      gesture_cues: {
        drag_held: { label: "dragged around" },
        window_sit: { label: "sat on window" },
        peek: { label: "peeking" },
        dropped: { label: "dropped from mid-air" },
      },
    },
    emotionRegistry: {},
    motions: {},
    guardrails: {
      debounce_ms: {
        idle_watcher: 0,
        os_event_watcher: 0,
        backend_push_source: 0,
        user_input_source: 0,
        screen_watcher: 5000,
      },
      rate_limit: {
        window_ms: 60_000,
        tier2_max: 10,
        tier3_max: 5,
        overall_max: 20,
        cooldown_ms: 30_000,
      },
      attachments: ATTACHMENT_LIMITS_DEFAULTS,
    },
    filler: {
      gap_ms: 1_000,
      gap_jitter_ms: 100,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
      pools: {},
    },
    hotkeys: { summon_global: "CmdOrCtrl+Shift+Y" },
    screen: {
      prev_dwell_ms: 600000,
      settle_ms: 90000,
      long_session_ms: 2700000,
      min_gap_ms: 300000,
      quiet_after_turn_ms: 180000,
      recent_cap: 5,
    },
  };
}

function fakeFactories(disposalOrder: string[] = []): ConfiguredBootstrapFactories {
  return {
    create: vi.fn(async (_cfg, _phase1, register) => {
      for (const name of [
        "voice",
        "dispatcher",
        "sources",
        "interactions",
        "summonHotkey",
        "broker",
      ]) {
        register(() => disposalOrder.push(name));
      }
      return {
        voice: { name: "voice" },
        dispatcher: { name: "dispatcher" },
        guardrails: { name: "guardrails" },
        summonHotkey: { name: "summonHotkey" },
        broker: { name: "broker" },
      } as never;
    }),
  };
}

describe("createConfiguredBootstrap", () => {
  it("constructs every configured handle with a valid config", async () => {
    const factories = fakeFactories();
    const configured = await createConfiguredBootstrap(validConfig(), {} as never, factories);

    expect(configured.voice).toBeTruthy();
    expect(configured.dispatcher).toBeTruthy();
    expect(configured.guardrails).toBeTruthy();
    expect(configured.summonHotkey).toBeTruthy();
    expect(configured.broker).toBeTruthy();
    expect(factories.create).toHaveBeenCalledWith(validConfig(), {}, expect.any(Function));
  });

  it("drains registered resources once in LIFO order", async () => {
    const order: string[] = [];
    const configured = await createConfiguredBootstrap(
      validConfig(),
      {} as never,
      fakeFactories(order),
    );

    configured.dispose();
    configured.dispose();

    expect(order).toEqual([
      "broker",
      "summonHotkey",
      "interactions",
      "sources",
      "dispatcher",
      "voice",
    ]);
  });

  it("drains partial registrations when construction throws", async () => {
    const order: string[] = [];
    const factories: ConfiguredBootstrapFactories = {
      create: vi.fn(async (_cfg, _phase1, register) => {
        register(() => order.push("voice"));
        register(() => order.push("dispatcher-partial"));
        throw new Error("dispatcher construction failed");
      }),
    };

    await expect(createConfiguredBootstrap(validConfig(), {} as never, factories)).rejects.toThrow(
      "dispatcher construction failed",
    );
    expect(order).toEqual(["dispatcher-partial", "voice"]);
  });

  it("continues draining after a disposer throws", async () => {
    const order: string[] = [];
    const failure = new Error("teardown failed");
    const factories: ConfiguredBootstrapFactories = {
      create: vi.fn(async (_cfg, _phase1, register) => {
        register(() => order.push("first"));
        register(() => {
          order.push("throwing");
          throw failure;
        });
        register(() => order.push("last"));
        return {} as never;
      }),
    };
    const configured = await createConfiguredBootstrap(validConfig(), {} as never, factories);

    expect(() => configured.dispose()).toThrow(failure);
    expect(order).toEqual(["last", "throwing", "first"]);
  });
});

describe("createPatGesture", () => {
  function harness() {
    const hitTest = { suspend: vi.fn(), resume: vi.fn() };
    const tapSource = {
      isHeadPoint: vi.fn(() => true),
      handlePatStart: vi.fn(),
      handlePatEnd: vi.fn(),
      handlePatAbort: vi.fn(),
    };
    return { hitTest, tapSource, pat: createPatGesture({ hitTest, tapSource, holdMs: () => 300 }) };
  }

  it("suspends the click-through hit-test for the length of the pat", () => {
    const { hitTest, tapSource, pat } = harness();

    pat.onStart();
    expect(hitTest.suspend).toHaveBeenCalledTimes(1);
    expect(hitTest.resume).not.toHaveBeenCalled();
    expect(tapSource.handlePatStart).toHaveBeenCalledTimes(1);

    pat.onEnd();
    expect(hitTest.resume).toHaveBeenCalledTimes(1);
    expect(tapSource.handlePatEnd).toHaveBeenCalledTimes(1);
  });

  it("resumes the hit-test when the pat is aborted", () => {
    const { hitTest, tapSource, pat } = harness();

    pat.onStart();
    pat.onAbort();
    expect(hitTest.resume).toHaveBeenCalledTimes(1);
    expect(tapSource.handlePatAbort).toHaveBeenCalledTimes(1);
    expect(tapSource.handlePatEnd).not.toHaveBeenCalled();
  });

  it("classifies the press point through the tap source and reads the hold live", () => {
    const { tapSource, pat } = harness();

    expect(pat.isPatPoint({ x: 5, y: 6 })).toBe(true);
    expect(tapSource.isHeadPoint).toHaveBeenCalledWith({ x: 5, y: 6 });
    expect(pat.holdMs()).toBe(300);
  });
});

describe("createSitLossFall", () => {
  it("stops a running climb before handing the window to the fall", () => {
    const order: string[] = [];
    const climber = { cancel: () => order.push("climber.cancel") };
    const onSitLost = createSitLossFall({
      getClimber: () => climber,
      faller: { drop: () => order.push("faller.drop") },
    });

    onSitLost();

    // A descent still inside its window survey would resume onto a falling window.
    expect(order).toEqual(["climber.cancel", "faller.drop"]);
  });

  it("falls when no climb is running", () => {
    const order: string[] = [];
    const onSitLost = createSitLossFall({
      getClimber: () => null,
      faller: { drop: () => order.push("faller.drop") },
    });

    onSitLost();

    expect(order).toEqual(["faller.drop"]);
  });
});
