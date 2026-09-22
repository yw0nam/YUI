import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../config/load";
import { CHAT_API_KEY_SECRET, STT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../../config/load";

const { createConfigStore } = vi.hoisted(() => ({ createConfigStore: vi.fn() }));
vi.mock("../../config/store", () => ({ createConfigStore }));

import { createPetConfig, wireConfigReload, wireConfigWatch } from "./wire-config";

const CFG = {
  endpoints: {
    chat_base_url: "http://from-config:8646",
    chat_instructions: "from config",
  },
  guardrails: {
    rate_limit: {
      window_ms: 60000,
      tier2_max: 5,
      tier3_max: 3,
      overall_max: 10,
      cooldown_ms: 1000,
    },
  },
} as unknown as AppConfig;

function fakeKeyStore(apiKey = "") {
  return { get: () => ({ apiKey }) };
}

function emptyStores() {
  return {
    endpointsSettings: { get: () => emptyEndpointOverrides },
    guardrailsSettings: { get: () => emptyGuardrailOverrides },
    chatKeySettings: fakeKeyStore(),
    sttKeySettings: fakeKeyStore(),
    ttsKeySettings: fakeKeyStore(),
  };
}

const emptyEndpointOverrides = {
  chat_base_url: "",
  stt_base_url: "",
  tts_base_url: "",
  broker_base_url: "",
  chat_model: "",
  chat_model_context_window: "",
  chat_api: "",
};
const emptyGuardrailOverrides = { tier2_max: 0, tier3_max: 0, overall_max: 0 };

beforeEach(() => {
  vi.stubEnv("VITE_YUI_CHAT_KEY", "");
  vi.stubEnv("VITE_YUI_STT_KEY", "");
  vi.stubEnv("VITE_YUI_TTS_KEY", "");
  createConfigStore.mockImplementation((opts: { secrets?: unknown }) => ({
    get: () => CFG,
    load: async () => CFG,
    secrets: opts.secrets,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPetConfig", () => {
  it("merges the bundled config with the settings overrides at call time", () => {
    let endpointOverrides = emptyEndpointOverrides;
    let guardrailOverrides = emptyGuardrailOverrides;
    const pet = createPetConfig({
      ...emptyStores(),
      endpointsSettings: { get: () => endpointOverrides },
      guardrailsSettings: { get: () => guardrailOverrides },
      log: { warn: vi.fn() },
    });

    expect(pet.getEndpoints().chat_base_url).toBe("http://from-config:8646");
    expect(pet.getGuardrails().rate_limit.tier2_max).toBe(5);

    endpointOverrides = { ...emptyEndpointOverrides, chat_base_url: "http://override:9000" };
    guardrailOverrides = { ...emptyGuardrailOverrides, tier2_max: 42 };
    expect(pet.getEndpoints().chat_base_url).toBe("http://override:9000");
    expect(pet.getGuardrails().rate_limit.tier2_max).toBe(42);
  });

  it("resolves each secret from its own key store", async () => {
    const pet = createPetConfig({
      ...emptyStores(),
      chatKeySettings: fakeKeyStore("sk-chat"),
      sttKeySettings: fakeKeyStore("sk-stt"),
      ttsKeySettings: fakeKeyStore("sk-tts"),
      log: { warn: vi.fn() },
    });

    await expect(pet.config.secrets.get(CHAT_API_KEY_SECRET)).resolves.toBe("sk-chat");
    await expect(pet.config.secrets.get(STT_API_KEY_SECRET)).resolves.toBe("sk-stt");
    await expect(pet.config.secrets.get(TTS_API_KEY_SECRET)).resolves.toBe("sk-tts");
  });

  it("falls through to undefined when a key store override is empty", async () => {
    const pet = createPetConfig({ ...emptyStores(), log: { warn: vi.fn() } });

    await expect(pet.config.secrets.get(CHAT_API_KEY_SECRET)).resolves.toBeUndefined();
  });

  it("warns once per key only when the store override and the build-time fallback are both empty", () => {
    const warn = vi.fn();
    createPetConfig({ ...emptyStores(), log: { warn } });

    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      "chat_key_missing",
      "stt_key_missing",
      "tts_key_missing",
    ]);
  });

  it("stays quiet for a key that has a store override or a build-time fallback", () => {
    const warn = vi.fn();
    vi.stubEnv("VITE_YUI_STT_KEY", "fb-stt");
    createPetConfig({
      ...emptyStores(),
      chatKeySettings: fakeKeyStore("sk-chat"),
      log: { warn },
    });

    expect(warn).toHaveBeenCalledExactlyOnceWith("tts_key_missing", { env: "VITE_YUI_TTS_KEY" });
  });
});

const RELOAD_CFG = {
  endpoints: { chat_api: "sse", chat_instructions: "hi" },
  guardrails: { attachments: { max_count: 2, max_mb: 8 } },
  hotkeys: { summon_global: "Alt+Space" },
  avatar: {
    framing: { zoom: 1 },
    gaze: { on: true },
    hit_test: { alpha_threshold: 0.4 },
    available: [],
    vrm_url: "/vrms/x.vrm",
  },
  motions: {
    idle: { vrma_path: "/motions/idle.vrma", variants: ["/motions/a.vrma", "/motions/b.vrma"] },
  },
  emotionRegistry: { emotions: [] },
} as unknown as AppConfig;

describe("wireConfigReload", () => {
  function reloadDeps() {
    const calls: string[] = [];
    const unsubscribe = vi.fn();
    const listeners: Array<(cfg: AppConfig, changed: ReadonlySet<string>) => void> = [];
    const deps = {
      config: {
        subscribe: vi.fn((listener: (cfg: AppConfig, changed: ReadonlySet<string>) => void) => {
          listeners.push(listener);
          return unsubscribe;
        }),
      },
      renderer: {
        setEmotionRegistry: vi.fn(() => void calls.push("setEmotionRegistry")),
        setIdleVariants: vi.fn(() => void calls.push("setIdleVariants")),
        setMotionRegistry: vi.fn(() => void calls.push("setMotionRegistry")),
        setFraming: vi.fn(() => void calls.push("setFraming")),
        setGaze: vi.fn(() => void calls.push("setGaze")),
        setHitTestThreshold: vi.fn(() => void calls.push("setHitTestThreshold")),
      },
      surfaces: { setAttachmentLimits: vi.fn(() => void calls.push("setAttachmentLimits")) },
      idleMotionSettings: { get: () => ({ disabled: ["/motions/b.vrma"] }) },
      getGuardrails: vi.fn(() => ({ tier2_max: 9 })),
      configured: {
        guardrails: { setConfig: vi.fn(() => void calls.push("guardrails.setConfig")) },
        summonHotkey: { apply: vi.fn(() => void calls.push("summonHotkey.apply")) },
        broker: { onConfigChange: vi.fn(() => void calls.push("broker.onConfigChange")) },
      },
      vrm: {
        vrmSelection: {
          setManifest: vi.fn(() => void calls.push("setManifest")),
          getActive: () => ({ url: "/vrms/active.vrm" }),
        },
        loadVrmSerialized: vi.fn(async () => {
          calls.push("loadVrmSerialized");
          return {};
        }),
      },
      refreshVoiceList: vi.fn(async () => {
        calls.push("refreshVoiceList");
      }),
      log: { error: vi.fn() },
    };
    const returned = wireConfigReload(deps as never);
    return { deps, calls, listeners, unsubscribe, returned };
  }

  it("returns the config subscription's own disposer", () => {
    const { unsubscribe, returned, deps } = reloadDeps();
    expect(returned).toBe(unsubscribe);
    expect(deps.config.subscribe).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
  });

  it("each changed section triggers only its own calls", () => {
    const cases: Array<[string, string[]]> = [
      ["emotionRegistry", ["setEmotionRegistry", "broker.onConfigChange"]],
      ["guardrails", ["guardrails.setConfig", "setAttachmentLimits", "broker.onConfigChange"]],
      ["hotkeys", ["summonHotkey.apply", "broker.onConfigChange"]],
      ["endpoints", ["refreshVoiceList", "broker.onConfigChange"]],
      [
        "avatar",
        [
          "broker.onConfigChange",
          "setFraming",
          "setGaze",
          "setHitTestThreshold",
          "setManifest",
          "loadVrmSerialized",
        ],
      ],
    ];
    for (const [section, expected] of cases) {
      const { calls, listeners } = reloadDeps();
      listeners[0]!(RELOAD_CFG, new Set([section]));
      expect(calls).toEqual(expected);
    }
  });

  it("sections with no reload wiring reach only the broker", () => {
    const { calls, listeners } = reloadDeps();
    listeners[0]!(RELOAD_CFG, new Set(["screen"]));
    expect(calls).toEqual(["broker.onConfigChange"]);
  });

  it("applies the enabled idle variants before the motion registry", () => {
    const { deps, calls, listeners } = reloadDeps();

    listeners[0]!(RELOAD_CFG, new Set(["motions"]));

    expect(calls).toEqual(["setIdleVariants", "setMotionRegistry", "broker.onConfigChange"]);
    expect(deps.renderer.setIdleVariants).toHaveBeenCalledWith(["/motions/a.vrma"]);
  });

  it("logs vrm_hot_swap_failed when the serialized avatar load rejects", async () => {
    const { deps, listeners } = reloadDeps();
    deps.vrm.loadVrmSerialized.mockRejectedValue(new Error("boom"));

    listeners[0]!(RELOAD_CFG, new Set(["avatar"]));
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.log.error).toHaveBeenCalledWith("vrm_hot_swap_failed", { error: "Error: boom" });
  });
});

describe("wireConfigWatch", () => {
  function watchDeps() {
    const registered: Array<() => void> = [];
    const config = {
      onError: vi.fn((_listener: (err: unknown) => void) => vi.fn()),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const log = { error: vi.fn() };
    const watch = wireConfigWatch({
      config: config as never,
      log: log as never,
      register: (teardown: () => void) => {
        registered.push(teardown);
      },
    });
    return { config, log, watch, registered };
  }

  it("logs reload errors as kept_previous", () => {
    const { config, log } = watchDeps();
    const onError = config.onError.mock.calls[0]![0];

    onError(new Error("bad json"));

    expect(log.error).toHaveBeenCalledWith("config_reload_failed", {
      kept_previous: true,
      error: "Error: bad json",
    });
  });

  it("does not register the onError unsubscriber", () => {
    const { registered } = watchDeps();

    expect(registered).toEqual([]);
  });

  it("startDev starts the poller, publishes __yuiConfig, and registers config.stop", () => {
    const { config, watch, registered } = watchDeps();

    watch.startDev();

    expect(config.start).toHaveBeenCalledOnce();
    expect((globalThis as Record<string, unknown>).__yuiConfig).toBe(config);
    expect(registered).toHaveLength(1);
    registered[0]!();
    expect(config.stop).toHaveBeenCalledOnce();
    delete (globalThis as Record<string, unknown>).__yuiConfig;
  });
});
