/**
 * endpoints-settings.test.ts — TDD red for the per-user endpoint-override reactive store.
 *
 * Pins the contract for src/io/endpoints-settings.ts:
 *   createEndpointsSettings({ storage?, initial? }) store (get/set/reset/reload/subscribe/dispose)
 *   localStorageEndpointsStorage(key?) localStorage adapter
 *   isValidEndpointUrl(v) — empty == "no override" == valid
 *   mergeEndpoints(base, overrides) — overlay non-empty valid overrides onto a base EndpointsConfig
 */

import { describe, it, expect, vi } from "vitest";
import {
  ENDPOINT_VALUE_MAX_LEN,
  createEndpointsSettings,
  localStorageEndpointsStorage,
  isValidEndpointUrl,
  mergeEndpoints,
} from "./endpoints-settings";
import type { EndpointsStorage, EndpointOverrides } from "./endpoints-settings";
import type { EndpointsConfig } from "../contract";

const EMPTY: EndpointOverrides = {
  chat_base_url: "",
  stt_base_url: "",
  tts_base_url: "",
  irodori_base_url: "",
  broker_base_url: "",
  chat_model: "",
  tts_provider: "",
};

function baseConfig(): EndpointsConfig {
  return {
    chat_base_url: "http://localhost:8643/v1",
    chat_endpoint: "/v1/responses",
    chat_model: "natsume",
    stt_base_url: "http://localhost:5517",
    tts_base_url: "http://localhost:8092",
    tts_provider: "irodori",
    irodori_base_url: "http://localhost:8091",
    irodori_speaker: "carlotta",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — defaults", () => {
  it("returns all-empty overrides when no storage or initial given", () => {
    const store = createEndpointsSettings();
    expect(store.get()).toEqual(EMPTY);
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createEndpointsSettings();
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("uses initial when no storage is provided", () => {
    const store = createEndpointsSettings({
      initial: { ...EMPTY, chat_base_url: "http://x", chat_model: "m" },
    });
    expect(store.get().chat_base_url).toBe("http://x");
    expect(store.get().chat_model).toBe("m");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — load coercion
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — load coercion", () => {
  it("loads valid stored overrides", () => {
    const storage: EndpointsStorage = {
      load: () => ({ ...EMPTY, tts_base_url: "https://tts.example", chat_model: "x" }),
      save: vi.fn(),
    };
    const store = createEndpointsSettings({ storage });
    expect(store.get().tts_base_url).toBe("https://tts.example");
    expect(store.get().chat_model).toBe("x");
  });

  it("coerces non-string fields to ''", () => {
    const storage: EndpointsStorage = {
      load: () =>
        ({ ...EMPTY, chat_base_url: 123, stt_base_url: null } as unknown as EndpointOverrides),
      save: vi.fn(),
    };
    const store = createEndpointsSettings({ storage });
    expect(store.get().chat_base_url).toBe("");
    expect(store.get().stt_base_url).toBe("");
  });

  it("caps each field length to ENDPOINT_VALUE_MAX_LEN", () => {
    const long = "h".repeat(ENDPOINT_VALUE_MAX_LEN + 100);
    const storage: EndpointsStorage = {
      load: () => ({ ...EMPTY, chat_base_url: long }),
      save: vi.fn(),
    };
    const store = createEndpointsSettings({ storage });
    expect(store.get().chat_base_url.length).toBe(ENDPOINT_VALUE_MAX_LEN);
  });

  it("ignores unknown keys and fills missing keys with ''", () => {
    const storage: EndpointsStorage = {
      load: () => ({ chat_model: "only" } as unknown as EndpointOverrides),
      save: vi.fn(),
    };
    const store = createEndpointsSettings({ storage });
    expect(store.get()).toEqual({ ...EMPTY, chat_model: "only" });
  });

  it("storage.load() returning null falls back to all-empty", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    expect(store.get()).toEqual(EMPTY);
  });

  it("storage.load() throwing falls back to all-empty", () => {
    const storage: EndpointsStorage = {
      load: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    };
    const store = createEndpointsSettings({ storage });
    expect(store.get()).toEqual(EMPTY);
  });

  it("stored > initial: storage value takes priority over initial option", () => {
    const storage: EndpointsStorage = {
      load: () => ({ ...EMPTY, chat_model: "stored" }),
      save: vi.fn(),
    };
    const store = createEndpointsSettings({
      storage,
      initial: { ...EMPTY, chat_model: "init" },
    });
    expect(store.get().chat_model).toBe("stored");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — set (partial merge)
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — set", () => {
  it("merges a partial, updates state, and notifies with a fresh copy", () => {
    const store = createEndpointsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.set({ chat_base_url: "http://a" });
    expect(store.get()).toEqual({ ...EMPTY, chat_base_url: "http://a" });
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ ...EMPTY, chat_base_url: "http://a" });
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("persists via storage.save", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    store.set({ chat_model: "custom" });
    expect(storage.save).toHaveBeenCalledWith({ ...EMPTY, chat_model: "custom" });
  });

  it("merges fields cumulatively across calls", () => {
    const store = createEndpointsSettings();
    store.set({ chat_base_url: "http://a" });
    store.set({ chat_model: "m" });
    expect(store.get()).toEqual({ ...EMPTY, chat_base_url: "http://a", chat_model: "m" });
  });

  it("coerces non-string partial values to ''", () => {
    const store = createEndpointsSettings({ initial: { ...EMPTY, chat_model: "had" } });
    store.set({ chat_model: 9 as unknown as string });
    expect(store.get().chat_model).toBe("");
  });

  it("does not trim stored user content (trim happens at merge time)", () => {
    const store = createEndpointsSettings();
    store.set({ chat_base_url: "  http://a  " });
    expect(store.get().chat_base_url).toBe("  http://a  ");
  });

  it("unchanged value is a no-op (no save, no notify)", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.set({ chat_model: "same" });
    store.set({ chat_model: "same" });
    expect(cb).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — reset
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — reset", () => {
  it("clears all fields to '' and notifies", () => {
    const store = createEndpointsSettings({
      initial: { ...EMPTY, chat_base_url: "http://a", chat_model: "m" },
    });
    const cb = vi.fn();
    store.subscribe(cb);
    store.reset();
    expect(store.get()).toEqual(EMPTY);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("persists the cleared state", () => {
    const storage: EndpointsStorage = { load: () => ({ ...EMPTY, chat_model: "m" }), save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    store.reset();
    expect(storage.save).toHaveBeenCalledWith(EMPTY);
  });

  it("is a no-op when already all-empty", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.reset();
    expect(cb).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — reloadFromStorage
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): EndpointsStorage & { _data: EndpointOverrides | null } {
  let data: EndpointOverrides | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: EndpointOverrides | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = { ...s };
    },
  };
}

describe("createEndpointsSettings — reloadFromStorage", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = { ...EMPTY, chat_base_url: "http://from-other" };
    store.reloadFromStorage();

    expect(store.get().chat_base_url).toBe("http://from-other");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("coerces invalid stored values on reload", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    storage._data = { ...EMPTY, chat_base_url: 9 } as unknown as EndpointOverrides;
    store.reloadFromStorage();
    expect(store.get()).toEqual(EMPTY);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    store.set({ chat_model: "m" });
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createEndpointsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: EndpointsStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createEndpointsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createEndpointsSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.set({ chat_model: "a" });
    unsub();
    store.set({ chat_model: "b" });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createEndpointsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.set({ chat_model: "a" });
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isValidEndpointUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidEndpointUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isValidEndpointUrl("http://localhost:8643/v1")).toBe(true);
    expect(isValidEndpointUrl("https://api.example.com")).toBe(true);
  });

  it("treats empty / whitespace-only as valid (no override)", () => {
    expect(isValidEndpointUrl("")).toBe(true);
    expect(isValidEndpointUrl("   ")).toBe(true);
  });

  it("trims before validating", () => {
    expect(isValidEndpointUrl("  http://localhost:8092  ")).toBe(true);
  });

  it("rejects scheme-less host:port", () => {
    expect(isValidEndpointUrl("localhost:5517")).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isValidEndpointUrl("ftp://host")).toBe(false);
    expect(isValidEndpointUrl("ws://host")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isValidEndpointUrl("not a url")).toBe(false);
    expect(isValidEndpointUrl("http://")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeEndpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("mergeEndpoints", () => {
  it("returns base unchanged when all overrides are empty", () => {
    const base = baseConfig();
    expect(mergeEndpoints(base, EMPTY)).toEqual(base);
  });

  it("does not mutate the base config", () => {
    const base = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeEndpoints(base, { ...EMPTY, chat_base_url: "http://new" });
    expect(base).toEqual(snapshot);
  });

  it("returns a new object", () => {
    const base = baseConfig();
    expect(mergeEndpoints(base, EMPTY)).not.toBe(base);
  });

  it("applies a valid URL override", () => {
    const out = mergeEndpoints(baseConfig(), { ...EMPTY, chat_base_url: "http://new:1/v1" });
    expect(out.chat_base_url).toBe("http://new:1/v1");
  });

  it("applies all four URL overrides + chat_model", () => {
    const out = mergeEndpoints(baseConfig(), {
      chat_base_url: "http://c",
      stt_base_url: "http://s",
      tts_base_url: "http://t",
      irodori_base_url: "http://i",
      chat_model: "model-x",
    });
    expect(out.chat_base_url).toBe("http://c");
    expect(out.stt_base_url).toBe("http://s");
    expect(out.tts_base_url).toBe("http://t");
    expect(out.irodori_base_url).toBe("http://i");
    expect(out.chat_model).toBe("model-x");
  });

  it("trims override values before applying", () => {
    const out = mergeEndpoints(baseConfig(), {
      ...EMPTY,
      chat_base_url: "  http://trimmed  ",
      chat_model: "  m  ",
    });
    expect(out.chat_base_url).toBe("http://trimmed");
    expect(out.chat_model).toBe("m");
  });

  it("ignores an invalid URL override (keeps base default)", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, stt_base_url: "localhost:5517" });
    expect(out.stt_base_url).toBe(base.stt_base_url);
  });

  it("ignores an empty override (keeps base default)", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, tts_base_url: "" });
    expect(out.tts_base_url).toBe(base.tts_base_url);
  });

  it("ignores a whitespace-only override (keeps base default)", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, chat_base_url: "   " });
    expect(out.chat_base_url).toBe(base.chat_base_url);
  });

  it("applies chat_model with no URL validation", () => {
    const out = mergeEndpoints(baseConfig(), { ...EMPTY, chat_model: "anything goes" });
    expect(out.chat_model).toBe("anything goes");
  });

  it("ignores an empty chat_model (keeps base default)", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, chat_model: "   " });
    expect(out.chat_model).toBe(base.chat_model);
  });

  it("sets irodori_base_url even when base has none", () => {
    const base = baseConfig();
    delete base.irodori_base_url;
    const out = mergeEndpoints(base, { ...EMPTY, irodori_base_url: "http://i" });
    expect(out.irodori_base_url).toBe("http://i");
  });

  it("preserves unrelated base fields", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, chat_base_url: "http://new" });
    expect(out.chat_endpoint).toBe(base.chat_endpoint);
    expect(out.irodori_speaker).toBe(base.irodori_speaker);
    expect(out.tts_provider).toBe(base.tts_provider);
  });

  // ── broker_base_url override ──

  it("applies a valid broker_base_url override", () => {
    const out = mergeEndpoints(baseConfig(), { ...EMPTY, broker_base_url: "http://localhost:3201/mcp" });
    expect(out.broker_base_url).toBe("http://localhost:3201/mcp");
  });

  it("trims a broker_base_url override before applying", () => {
    const out = mergeEndpoints(baseConfig(), { ...EMPTY, broker_base_url: "  https://broker.example/mcp  " });
    expect(out.broker_base_url).toBe("https://broker.example/mcp");
  });

  it("ignores an invalid broker_base_url override (keeps base default)", () => {
    const base = baseConfig();
    base.broker_base_url = "http://localhost:3201/mcp";
    const out = mergeEndpoints(base, { ...EMPTY, broker_base_url: "localhost:3201" });
    expect(out.broker_base_url).toBe("http://localhost:3201/mcp");
  });

  it("ignores an empty broker_base_url override (keeps base default)", () => {
    const base = baseConfig();
    base.broker_base_url = "http://localhost:3201/mcp";
    const out = mergeEndpoints(base, { ...EMPTY, broker_base_url: "" });
    expect(out.broker_base_url).toBe("http://localhost:3201/mcp");
  });

  // ── tts_provider override ──

  it("applies tts_provider = 'openai'", () => {
    const out = mergeEndpoints(baseConfig(), { ...EMPTY, tts_provider: "openai" });
    expect(out.tts_provider).toBe("openai");
  });

  it("applies tts_provider = 'irodori'", () => {
    const base = baseConfig();
    base.tts_provider = "openai";
    const out = mergeEndpoints(base, { ...EMPTY, tts_provider: "irodori" });
    expect(out.tts_provider).toBe("irodori");
  });

  it("ignores an empty tts_provider override (keeps base default)", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, tts_provider: "" });
    expect(out.tts_provider).toBe(base.tts_provider);
  });

  it("ignores an unknown tts_provider override (keeps base default)", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, tts_provider: "fishspeech" });
    expect(out.tts_provider).toBe(base.tts_provider);
  });

  it("does not URL-validate tts_provider", () => {
    const out = mergeEndpoints(baseConfig(), { ...EMPTY, tts_provider: "openai" });
    expect(out.tts_provider).toBe("openai");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// broker_base_url + tts_provider — store set/get/persist/reload/reset
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — broker_base_url + tts_provider overrides", () => {
  it("set/get a broker_base_url override and persist it", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    store.set({ broker_base_url: "http://localhost:3201/mcp" });
    expect(store.get().broker_base_url).toBe("http://localhost:3201/mcp");
    expect(storage.save).toHaveBeenCalledWith({ ...EMPTY, broker_base_url: "http://localhost:3201/mcp" });
  });

  it("set/get a tts_provider override and persist it", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    store.set({ tts_provider: "openai" });
    expect(store.get().tts_provider).toBe("openai");
    expect(storage.save).toHaveBeenCalledWith({ ...EMPTY, tts_provider: "openai" });
  });

  it("coerces a garbage tts_provider value to '' on set (no throw)", () => {
    const store = createEndpointsSettings();
    store.set({ tts_provider: "fishspeech" as unknown as string });
    expect(store.get().tts_provider).toBe("");
  });

  it("coerces a non-string tts_provider value to '' on set", () => {
    const store = createEndpointsSettings();
    store.set({ tts_provider: 7 as unknown as string });
    expect(store.get().tts_provider).toBe("");
  });

  it("loads a valid tts_provider from storage and coerces a garbage one to ''", () => {
    const good: EndpointsStorage = { load: () => ({ ...EMPTY, tts_provider: "irodori" }), save: vi.fn() };
    expect(createEndpointsSettings({ storage: good }).get().tts_provider).toBe("irodori");
    const bad: EndpointsStorage = {
      load: () => ({ ...EMPTY, tts_provider: "garbage" } as unknown as EndpointOverrides),
      save: vi.fn(),
    };
    expect(createEndpointsSettings({ storage: bad }).get().tts_provider).toBe("");
  });

  it("reset() clears both broker_base_url and tts_provider", () => {
    const store = createEndpointsSettings({
      initial: { ...EMPTY, broker_base_url: "http://localhost:3201/mcp", tts_provider: "openai" },
    });
    store.reset();
    expect(store.get().broker_base_url).toBe("");
    expect(store.get().tts_provider).toBe("");
  });

  it("reloadFromStorage applies externally-changed broker_base_url and tts_provider", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    storage._data = { ...EMPTY, broker_base_url: "http://other:3201/mcp", tts_provider: "openai" };
    store.reloadFromStorage();
    expect(store.get().broker_base_url).toBe("http://other:3201/mcp");
    expect(store.get().tts_provider).toBe("openai");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageEndpointsStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageEndpointsStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageEndpointsStorage();
    adapter.save({ ...EMPTY, chat_model: "yo" });
    expect(adapter.load()).toEqual({ ...EMPTY, chat_model: "yo" });

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.endpoints'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageEndpointsStorage();
    adapter.save(EMPTY);
    expect(written[0][0]).toBe("yui.endpoints");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageEndpointsStorage("my.key");
    adapter.save(EMPTY);
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });

  it("JSON parse failure returns null", () => {
    (globalThis as any).localStorage = {
      getItem: () => "{not json",
      setItem: () => {},
    };
    const adapter = localStorageEndpointsStorage();
    expect(adapter.load()).toBeNull();
    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageEndpointsStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save(EMPTY)).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});
