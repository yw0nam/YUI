/**
 * agent-settings.test.ts — TDD red for the AI agent request-shaping reactive store.
 *
 * Pins the contract for src/io/agent-settings.ts:
 *   REASONING_EFFORTS / INSTRUCTIONS_MAX_LEN constants
 *   createAgentSettings({ storage?, initial? }) store
 *   localStorageAgentStorage(key?) localStorage adapter
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentSettings, AgentStorage } from "./agent-settings";
import {
  createAgentSettings,
  INSTRUCTIONS_MAX_LEN,
  localStorageAgentStorage,
  REASONING_EFFORTS,
} from "./agent-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("agent-settings constants", () => {
  it("REASONING_EFFORTS is the expected ordered list", () => {
    expect(REASONING_EFFORTS).toEqual(["default", "low", "medium", "high"]);
  });

  it("INSTRUCTIONS_MAX_LEN is 4000", () => {
    expect(INSTRUCTIONS_MAX_LEN).toBe(4000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — defaults", () => {
  it("returns default state when no storage or initial given", () => {
    const store = createAgentSettings();
    expect(store.get()).toEqual({ reasoning_effort: "default", instructions: "" });
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createAgentSettings();
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("uses initial when no storage is provided", () => {
    const store = createAgentSettings({
      initial: { reasoning_effort: "high", instructions: "be terse" },
    });
    expect(store.get()).toEqual({ reasoning_effort: "high", instructions: "be terse" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — load coercion
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — load coercion", () => {
  it("loads valid stored settings", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "medium", instructions: "hi" }),
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get()).toEqual({ reasoning_effort: "medium", instructions: "hi" });
  });

  it("coerces invalid stored reasoning_effort to 'default'", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "bogus", instructions: "x" }) as unknown as AgentSettings,
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get().reasoning_effort).toBe("default");
    expect(store.get().instructions).toBe("x");
  });

  it("coerces non-string stored instructions to ''", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "low", instructions: 123 }) as unknown as AgentSettings,
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get().instructions).toBe("");
    expect(store.get().reasoning_effort).toBe("low");
  });

  it("caps stored instructions length to INSTRUCTIONS_MAX_LEN", () => {
    const long = "a".repeat(INSTRUCTIONS_MAX_LEN + 100);
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "default", instructions: long }),
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get().instructions.length).toBe(INSTRUCTIONS_MAX_LEN);
  });

  it("storage.load() returning null falls back to default", () => {
    const storage: AgentStorage = { load: () => null, save: vi.fn() };
    const store = createAgentSettings({ storage });
    expect(store.get()).toEqual({ reasoning_effort: "default", instructions: "" });
  });

  it("storage.load() throwing falls back to default", () => {
    const storage: AgentStorage = {
      load: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get()).toEqual({ reasoning_effort: "default", instructions: "" });
  });

  it("stored > initial: storage value takes priority over initial option", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "high", instructions: "stored" }),
      save: vi.fn(),
    };
    const store = createAgentSettings({
      storage,
      initial: { reasoning_effort: "low", instructions: "init" },
    });
    expect(store.get()).toEqual({ reasoning_effort: "high", instructions: "stored" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — setReasoningEffort
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — setReasoningEffort", () => {
  it("updates state and notifies with a fresh copy", () => {
    const store = createAgentSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setReasoningEffort("high");
    expect(store.get().reasoning_effort).toBe("high");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ reasoning_effort: "high", instructions: "" });
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("persists via storage.save", () => {
    const storage: AgentStorage = { load: () => null, save: vi.fn() };
    const store = createAgentSettings({ storage });
    store.setReasoningEffort("medium");
    expect(storage.save).toHaveBeenCalledWith({
      reasoning_effort: "medium",
      instructions: "",
    });
  });

  it("invalid effort coerces to 'default' (no-op from default state)", () => {
    const store = createAgentSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setReasoningEffort("nope" as unknown as AgentSettings["reasoning_effort"]);
    expect(store.get().reasoning_effort).toBe("default");
    expect(cb).not.toHaveBeenCalled();
  });

  it("invalid effort coerces to 'default' (notifies when changing from non-default)", () => {
    const store = createAgentSettings({
      initial: { reasoning_effort: "high", instructions: "" },
    });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setReasoningEffort("nope" as unknown as AgentSettings["reasoning_effort"]);
    expect(store.get().reasoning_effort).toBe("default");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("unchanged value is a no-op (no save, no notify)", () => {
    const storage: AgentStorage = { load: () => null, save: vi.fn() };
    const store = createAgentSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setReasoningEffort("low");
    store.setReasoningEffort("low");
    expect(cb).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — setInstructions
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — setInstructions", () => {
  it("updates state and notifies with a fresh copy", () => {
    const store = createAgentSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setInstructions("hello");
    expect(store.get().instructions).toBe("hello");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ reasoning_effort: "default", instructions: "hello" });
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("persists via storage.save", () => {
    const storage: AgentStorage = { load: () => null, save: vi.fn() };
    const store = createAgentSettings({ storage });
    store.setInstructions("custom");
    expect(storage.save).toHaveBeenCalledWith({
      reasoning_effort: "default",
      instructions: "custom",
    });
  });

  it("caps length at INSTRUCTIONS_MAX_LEN", () => {
    const store = createAgentSettings();
    store.setInstructions("b".repeat(INSTRUCTIONS_MAX_LEN + 50));
    expect(store.get().instructions.length).toBe(INSTRUCTIONS_MAX_LEN);
  });

  it("non-string coerces to ''", () => {
    const store = createAgentSettings({
      initial: { reasoning_effort: "default", instructions: "had text" },
    });
    store.setInstructions(42 as unknown as string);
    expect(store.get().instructions).toBe("");
  });

  it("does not trim user content", () => {
    const store = createAgentSettings();
    store.setInstructions("  padded  ");
    expect(store.get().instructions).toBe("  padded  ");
  });

  it("unchanged value is a no-op (no save, no notify)", () => {
    const storage: AgentStorage = { load: () => null, save: vi.fn() };
    const store = createAgentSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setInstructions("same");
    store.setInstructions("same");
    expect(cb).toHaveBeenCalledOnce();
    expect(storage.save).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — reloadFromStorage
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): AgentStorage & { _data: AgentSettings | null } {
  let data: AgentSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: AgentSettings | null) {
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

describe("createAgentSettings — reloadFromStorage", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    // 다른 창이 storage를 직접 갱신한 상황을 모사
    storage._data = { reasoning_effort: "high", instructions: "from other window" };
    store.reloadFromStorage();

    expect(store.get()).toEqual({ reasoning_effort: "high", instructions: "from other window" });
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({
      reasoning_effort: "high",
      instructions: "from other window",
    });
  });

  it("coerces invalid stored values on reload", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    storage._data = { reasoning_effort: "bogus", instructions: 9 } as unknown as AgentSettings;
    store.reloadFromStorage();
    expect(store.get()).toEqual({ reasoning_effort: "default", instructions: "" });
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    store.setReasoningEffort("medium");
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createAgentSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: AgentStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createAgentSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.setReasoningEffort("low");
    unsub();
    store.setReasoningEffort("high");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createAgentSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setReasoningEffort("low");
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageAgentStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageAgentStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageAgentStorage();
    adapter.save({ reasoning_effort: "high", instructions: "yo" });
    const loaded = adapter.load();
    expect(loaded).toEqual({ reasoning_effort: "high", instructions: "yo" });

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.agent'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageAgentStorage();
    adapter.save({ reasoning_effort: "default", instructions: "" });
    expect(written[0][0]).toBe("yui.agent");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageAgentStorage("my.key");
    adapter.save({ reasoning_effort: "default", instructions: "" });
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });

  it("JSON parse failure returns null", () => {
    (globalThis as any).localStorage = {
      getItem: () => "{not json",
      setItem: () => {},
    };
    const adapter = localStorageAgentStorage();
    expect(adapter.load()).toBeNull();
    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageAgentStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save({ reasoning_effort: "default", instructions: "" })).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});
