/**
 * endpoints-settings.test.ts — per-user endpoint-override reactive store.
 *
 * Pins the contract for src/io/endpoints-settings.ts:
 *   createEndpointsSettings({ storage?, initial? }) store (get/set/reset/reload/subscribe/dispose)
 *   localStorageEndpointsStorage(key?) localStorage adapter
 *   isValidEndpointUrl(v) — empty == "no override" == valid
 *   mergeEndpoints(base, overrides) — overlay non-empty valid overrides onto a base EndpointsConfig
 */

import { describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import type { EndpointOverrides, EndpointsStorage } from "./endpoints-settings";
import {
  createEndpointsSettings,
  ENDPOINT_FIELD_SPECS,
  ENDPOINT_VALUE_MAX_LEN,
  endpointDefaultsFromConfig,
  isValidEndpointUrl,
  localStorageEndpointsStorage,
  mergeEndpoints,
} from "./endpoints-settings";

const EMPTY: EndpointOverrides = {
  chat_base_url: "",
  stt_base_url: "",
  tts_base_url: "",
  broker_base_url: "",
  chat_model: "",
  chat_model_context_window: "",
  chat_api: "",
};

function baseConfig(): EndpointsConfig {
  return {
    chat_base_url: "http://localhost:8643/v1",
    chat_endpoint: "/v1/responses",
    chat_model: "natsume",
    stt_base_url: "http://localhost:5517",
    tts_base_url: "http://localhost:8092",
    tts_model: "irodori-tts",
    tts_speaker: "ナツメ",
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
        ({ ...EMPTY, chat_base_url: 123, stt_base_url: null }) as unknown as EndpointOverrides,
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
      load: () => ({ chat_model: "only" }) as unknown as EndpointOverrides,
      save: vi.fn(),
    };
    const store = createEndpointsSettings({ storage });
    expect(store.get()).toEqual({ ...EMPTY, chat_model: "only" });
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
    const storage: EndpointsStorage = {
      load: () => ({ ...EMPTY, chat_model: "m" }),
      save: vi.fn(),
    };
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
  it("coerces invalid stored values on reload", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    storage._data = { ...EMPTY, chat_base_url: 9 } as unknown as EndpointOverrides;
    store.reloadFromStorage();
    expect(store.get()).toEqual(EMPTY);
  });

  it("keeps the in-memory overrides when the stored value is corrupted", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    store.set({ chat_base_url: "http://a", chat_model: "user-model" });

    storage._data = "garbage" as unknown as EndpointOverrides;
    store.reloadFromStorage();

    expect(store.get()).toEqual({ ...EMPTY, chat_base_url: "http://a", chat_model: "user-model" });
  });

  it("keeps the in-memory overrides when the stored value is an array", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    store.set({ chat_base_url: "http://a", chat_model: "user-model" });

    storage._data = [] as unknown as EndpointOverrides;
    store.reloadFromStorage();

    expect(store.get()).toEqual({ ...EMPTY, chat_base_url: "http://a", chat_model: "user-model" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — bootstrap keeps initial over a corrupted stored value
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — bootstrap keeps initial over a corrupted stored value", () => {
  it("does not adopt a corrupted stored value when initial is provided", () => {
    const storage: EndpointsStorage = {
      load: () => "garbage" as unknown as EndpointOverrides,
      save: vi.fn(),
    };
    const store = createEndpointsSettings({
      storage,
      initial: { ...EMPTY, chat_base_url: "http://a", chat_model: "user-model" },
    });
    expect(store.get()).toEqual({ ...EMPTY, chat_base_url: "http://a", chat_model: "user-model" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createEndpointsSettings — subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

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

  it("stores only positive digit strings and merges the context window as a number", () => {
    const store = createEndpointsSettings();
    store.set({ chat_model_context_window: "128000" });
    expect(store.get().chat_model_context_window).toBe("128000");
    expect(mergeEndpoints(baseConfig(), store.get()).chat_model_context_window).toBe(128000);

    store.set({ chat_model_context_window: "0" });
    expect(store.get().chat_model_context_window).toBe("");
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

  it("applies all URL overrides + chat_model", () => {
    const out = mergeEndpoints(baseConfig(), {
      ...EMPTY,
      chat_base_url: "http://c",
      stt_base_url: "http://s",
      tts_base_url: "http://t",
      broker_base_url: "http://b",
      chat_model: "model-x",
    });
    expect(out.chat_base_url).toBe("http://c");
    expect(out.stt_base_url).toBe("http://s");
    expect(out.tts_base_url).toBe("http://t");
    expect(out.broker_base_url).toBe("http://b");
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

  it("sets broker_base_url even when base has none", () => {
    const base = baseConfig();
    delete base.broker_base_url;
    const out = mergeEndpoints(base, { ...EMPTY, broker_base_url: "http://b" });
    expect(out.broker_base_url).toBe("http://b");
  });

  it("preserves unrelated base fields", () => {
    const base = baseConfig();
    const out = mergeEndpoints(base, { ...EMPTY, chat_base_url: "http://new" });
    expect(out.chat_endpoint).toBe(base.chat_endpoint);
    expect(out.tts_speaker).toBe(base.tts_speaker);
    expect(out.tts_model).toBe(base.tts_model);
  });

  // ── broker_base_url override ──

  it("applies a valid broker_base_url override", () => {
    const out = mergeEndpoints(baseConfig(), {
      ...EMPTY,
      broker_base_url: "http://localhost:3201/mcp",
    });
    expect(out.broker_base_url).toBe("http://localhost:3201/mcp");
  });

  it("trims a broker_base_url override before applying", () => {
    const out = mergeEndpoints(baseConfig(), {
      ...EMPTY,
      broker_base_url: "  https://broker.example/mcp  ",
    });
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

  // ── chat_api override ──

  it("applies chat_api = 'chat_completions'", () => {
    const out = mergeEndpoints(baseConfig(), { ...EMPTY, chat_api: "chat_completions" });
    expect(out.chat_api).toBe("chat_completions");
  });

  it("applies chat_api = 'responses'", () => {
    const base = baseConfig();
    base.chat_api = "chat_completions";
    const out = mergeEndpoints(base, { ...EMPTY, chat_api: "responses" });
    expect(out.chat_api).toBe("responses");
  });

  it("ignores an empty chat_api override (keeps base default)", () => {
    const base = baseConfig();
    base.chat_api = "responses";
    const out = mergeEndpoints(base, { ...EMPTY, chat_api: "" });
    expect(out.chat_api).toBe("responses");
  });

  it("ignores an unknown chat_api override (keeps base default)", () => {
    const base = baseConfig();
    base.chat_api = "responses";
    const out = mergeEndpoints(base, { ...EMPTY, chat_api: "graphql" });
    expect(out.chat_api).toBe("responses");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// broker_base_url — store set/get/persist/reload/reset
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — broker_base_url override", () => {
  it("set/get a broker_base_url override and persist it", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    store.set({ broker_base_url: "http://localhost:3201/mcp" });
    expect(store.get().broker_base_url).toBe("http://localhost:3201/mcp");
    expect(storage.save).toHaveBeenCalledWith({
      ...EMPTY,
      broker_base_url: "http://localhost:3201/mcp",
    });
  });

  it("reset() clears broker_base_url", () => {
    const store = createEndpointsSettings({
      initial: { ...EMPTY, broker_base_url: "http://localhost:3201/mcp" },
    });
    store.reset();
    expect(store.get().broker_base_url).toBe("");
  });

  it("reloadFromStorage applies an externally-changed broker_base_url", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    storage._data = { ...EMPTY, broker_base_url: "http://other:3201/mcp" };
    store.reloadFromStorage();
    expect(store.get().broker_base_url).toBe("http://other:3201/mcp");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// chat_api — store set/get/persist/reload/reset
// ─────────────────────────────────────────────────────────────────────────────

describe("createEndpointsSettings — chat_api override", () => {
  it("set/get a chat_api override and persist it", () => {
    const storage: EndpointsStorage = { load: () => null, save: vi.fn() };
    const store = createEndpointsSettings({ storage });
    store.set({ chat_api: "chat_completions" });
    expect(store.get().chat_api).toBe("chat_completions");
    expect(storage.save).toHaveBeenCalledWith({ ...EMPTY, chat_api: "chat_completions" });
  });

  it("coerces a garbage chat_api value to '' on set (no throw)", () => {
    const store = createEndpointsSettings();
    store.set({ chat_api: "graphql" as unknown as string });
    expect(store.get().chat_api).toBe("");
  });

  it("coerces a non-string chat_api value to '' on set", () => {
    const store = createEndpointsSettings();
    store.set({ chat_api: 7 as unknown as string });
    expect(store.get().chat_api).toBe("");
  });

  it("loads a valid chat_api from storage and coerces a garbage one to ''", () => {
    const good: EndpointsStorage = {
      load: () => ({ ...EMPTY, chat_api: "chat_completions" }),
      save: vi.fn(),
    };
    expect(createEndpointsSettings({ storage: good }).get().chat_api).toBe("chat_completions");
    const bad: EndpointsStorage = {
      load: () => ({ ...EMPTY, chat_api: "garbage" }) as unknown as EndpointOverrides,
      save: vi.fn(),
    };
    expect(createEndpointsSettings({ storage: bad }).get().chat_api).toBe("");
  });

  it("reset() clears chat_api", () => {
    const store = createEndpointsSettings({
      initial: { ...EMPTY, chat_api: "chat_completions" },
    });
    store.reset();
    expect(store.get().chat_api).toBe("");
  });

  it("reloadFromStorage applies an externally-changed chat_api", () => {
    const storage = makeMemStorage();
    const store = createEndpointsSettings({ storage });
    storage._data = { ...EMPTY, chat_api: "chat_completions" };
    store.reloadFromStorage();
    expect(store.get().chat_api).toBe("chat_completions");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageEndpointsStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageEndpointsStorage", () => {
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
});

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT_FIELD_SPECS — declarative table FIELDS/EMPTY/coerceFor/mergeEndpoints and the UI's
// ENDPOINT_FIELDS + both windows' endpoint defaults derive from (one row per overridable value).
// ─────────────────────────────────────────────────────────────────────────────

describe("ENDPOINT_FIELD_SPECS", () => {
  it("has exactly one row per EndpointOverrides key (totality, no duplicates)", () => {
    const keys = ENDPOINT_FIELD_SPECS.map((s) => s.key);
    expect(keys.sort()).toEqual(Object.keys(EMPTY).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("assigns kind 'url' to the four base-url fields", () => {
    const urlKeys = ENDPOINT_FIELD_SPECS.filter((s) => s.kind === "url").map((s) => s.key);
    expect(urlKeys.sort()).toEqual(
      ["chat_base_url", "stt_base_url", "tts_base_url", "broker_base_url"].sort(),
    );
  });

  it("assigns kind 'string' to chat_model only", () => {
    const stringKeys = ENDPOINT_FIELD_SPECS.filter((s) => s.kind === "string").map((s) => s.key);
    expect(stringKeys).toEqual(["chat_model"]);
  });

  it("assigns kind 'posInt' to chat_model_context_window only", () => {
    const posIntKeys = ENDPOINT_FIELD_SPECS.filter((s) => s.kind === "posInt").map((s) => s.key);
    expect(posIntKeys).toEqual(["chat_model_context_window"]);
  });

  it("assigns kind 'enum' to chat_api with its valid-value list", () => {
    const chatApi = ENDPOINT_FIELD_SPECS.find((s) => s.key === "chat_api")!;
    expect(chatApi.kind).toBe("enum");
    expect(chatApi.enum).toEqual(["responses", "chat_completions"]);
  });
});

// Pins the per-service reset behavior endpoints-section.ts's handleSvcReset derives from
// `resetGroup` — grouping by resetGroup must reproduce today's hand-written reset sets exactly
// (including the chat_api special-case), or the reset buttons silently start clearing
// more/less than before.
describe("ENDPOINT_FIELD_SPECS — resetGroup (endpoints-section.ts per-service reset wiring)", () => {
  const bySvc = (svc: string): string[] =>
    ENDPOINT_FIELD_SPECS.filter((s) => s.resetGroup === svc)
      .map((s) => s.key)
      .sort();

  it("chat reset group is chat_base_url + chat_model + chat_api", () => {
    expect(bySvc("chat")).toEqual(["chat_api", "chat_base_url", "chat_model"].sort());
  });

  it("stt reset group is stt_base_url only", () => {
    expect(bySvc("stt")).toEqual(["stt_base_url"]);
  });

  it("tts reset group is tts_base_url only", () => {
    expect(bySvc("tts")).toEqual(["tts_base_url"]);
  });

  it("broker reset group is broker_base_url only", () => {
    expect(bySvc("broker")).toEqual(["broker_base_url"]);
  });

  it("chat_model_context_window carries no resetGroup (no reset button clears it today)", () => {
    const spec = ENDPOINT_FIELD_SPECS.find((s) => s.key === "chat_model_context_window")!;
    expect(spec.resetGroup).toBeUndefined();
  });
});

// Table-driven invariant: every row's coercion follows from its declared `kind`, so a field added
// to the table without matching coercion cannot silently accept garbage.
describe("coerceFor — dispatch by ENDPOINT_FIELD_SPECS kind", () => {
  it("enum-kind fields reject values outside their enum list", () => {
    for (const spec of ENDPOINT_FIELD_SPECS.filter((s) => s.kind === "enum")) {
      const store = createEndpointsSettings();
      store.set({ [spec.key]: "not-a-real-value" } as unknown as Partial<EndpointOverrides>);
      expect(store.get()[spec.key]).toBe("");
    }
  });

  it("posInt-kind fields accept only positive digit strings", () => {
    for (const spec of ENDPOINT_FIELD_SPECS.filter((s) => s.kind === "posInt")) {
      const store = createEndpointsSettings();
      store.set({ [spec.key]: "abc" } as unknown as Partial<EndpointOverrides>);
      expect(store.get()[spec.key]).toBe("");
      store.set({ [spec.key]: "0" } as unknown as Partial<EndpointOverrides>);
      expect(store.get()[spec.key]).toBe("");
      store.set({ [spec.key]: "42" } as unknown as Partial<EndpointOverrides>);
      expect(store.get()[spec.key]).toBe("42");
    }
  });

  it("url/string-kind fields cap length at ENDPOINT_VALUE_MAX_LEN", () => {
    const long = "h".repeat(ENDPOINT_VALUE_MAX_LEN + 10);
    for (const spec of ENDPOINT_FIELD_SPECS.filter(
      (s) => s.kind === "url" || s.kind === "string",
    )) {
      const store = createEndpointsSettings();
      store.set({ [spec.key]: long } as unknown as Partial<EndpointOverrides>);
      expect(store.get()[spec.key].length).toBe(ENDPOINT_VALUE_MAX_LEN);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// endpointDefaultsFromConfig — the single projection main.ts + settings-main.ts both call instead
// of hand-writing the same field-by-field literal.
// ─────────────────────────────────────────────────────────────────────────────

describe("endpointDefaultsFromConfig", () => {
  it("projects a bundled EndpointsConfig onto the override shape ('' for unset optionals)", () => {
    expect(endpointDefaultsFromConfig(baseConfig())).toEqual({
      chat_base_url: "http://localhost:8643/v1",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      broker_base_url: "",
      chat_model: "natsume",
      chat_model_context_window: "",
      chat_api: "",
    });
  });

  it("stringifies chat_model_context_window (number → digit string)", () => {
    const cfg = { ...baseConfig(), chat_model_context_window: 64000 };
    expect(endpointDefaultsFromConfig(cfg).chat_model_context_window).toBe("64000");
  });

  it("passes through the chat_api enum value as-is", () => {
    const cfg = { ...baseConfig(), chat_api: "chat_completions" as const };
    expect(endpointDefaultsFromConfig(cfg).chat_api).toBe("chat_completions");
  });
});
