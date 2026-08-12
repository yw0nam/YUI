import { describe, expect, it, vi } from "vitest";
import {
  type ConfiguredBootstrapFactories,
  createConfiguredBootstrap,
} from "./bootstrap-configured";
import { type AppConfig, ATTACHMENT_LIMITS_DEFAULTS } from "./config";

function validConfig(): AppConfig {
  return {
    endpoints: {
      chat_base_url: "http://chat.test/v1",
      chat_endpoint: "/responses",
      stt_base_url: "http://stt.test/v1",
      tts_base_url: "http://tts.test/v1",
      tts_provider: "openai",
    },
    avatar: {
      vrm_url: "/vrms/test.vrm",
      available: [{ id: "test", label: "Test", url: "/vrms/test.vrm" }],
      tap: {
        spam_count: 4,
        spam_window_ms: 3_000,
        region_radius_frac: 0.18,
        region_motions: { chest: "embarrassed", hips: "embarrassed" },
        bored_cue: { label: "bored poking" },
        touch_cue_cooldown_ms: 60_000,
        touch_emotion_hold_ms: 4_000,
      },
      peek: {
        side_out_frac: 0.28,
        side_in_frac: 0.23,
        inset_frac: 0.12,
        mirror_side: "right",
      },
      drag_hold_ms: 5_000,
      gesture_cues: {
        drag_held: { label: "dragged around" },
        window_sit: { label: "sat on window" },
        peek: { label: "peeking" },
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
    filler: { gap_ms: 1_000, gap_jitter_ms: 100, pools: {} },
    hotkeys: { summon_global: "CmdOrCtrl+Shift+Y" },
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
