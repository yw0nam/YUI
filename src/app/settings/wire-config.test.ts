import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../config/load";
import { CHAT_API_KEY_SECRET, STT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../../config/load";

const { createConfigStore } = vi.hoisted(() => ({ createConfigStore: vi.fn() }));
vi.mock("../../config/store", () => ({ createConfigStore }));

import { createPetConfig } from "./wire-config";

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
