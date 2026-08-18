/**
 * agent-settings.test.ts — AI agent request-shaping reactive store.
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
    expect(REASONING_EFFORTS).toEqual(["none", "minimal", "low", "medium"]);
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
    expect(store.get()).toEqual({ reasoning_effort: "none", instructions: "" });
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

  it("coerces invalid stored reasoning_effort to 'none'", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "bogus", instructions: "x" }) as unknown as AgentSettings,
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get().reasoning_effort).toBe("none");
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
      load: () => ({ reasoning_effort: "none", instructions: long }),
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get().instructions.length).toBe(INSTRUCTIONS_MAX_LEN);
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
    store.setReasoningEffort("medium");
    expect(store.get().reasoning_effort).toBe("medium");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ reasoning_effort: "medium", instructions: "" });
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

  it("invalid effort coerces to 'none' (no-op from default state)", () => {
    const store = createAgentSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setReasoningEffort("nope" as unknown as AgentSettings["reasoning_effort"]);
    expect(store.get().reasoning_effort).toBe("none");
    expect(cb).not.toHaveBeenCalled();
  });

  it("invalid effort coerces to 'none' (notifies when changing from non-default)", () => {
    const store = createAgentSettings({
      initial: { reasoning_effort: "medium", instructions: "" },
    });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setReasoningEffort("nope" as unknown as AgentSettings["reasoning_effort"]);
    expect(store.get().reasoning_effort).toBe("none");
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
    expect(cb).toHaveBeenCalledWith({ reasoning_effort: "none", instructions: "hello" });
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("persists via storage.save", () => {
    const storage: AgentStorage = { load: () => null, save: vi.fn() };
    const store = createAgentSettings({ storage });
    store.setInstructions("custom");
    expect(storage.save).toHaveBeenCalledWith({
      reasoning_effort: "none",
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
      initial: { reasoning_effort: "none", instructions: "had text" },
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
  it("coerces invalid stored values on reload", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    storage._data = { reasoning_effort: "bogus", instructions: 9 } as unknown as AgentSettings;
    store.reloadFromStorage();
    expect(store.get()).toEqual({ reasoning_effort: "none", instructions: "" });
  });

  it("keeps the in-memory instructions when the stored value is corrupted", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    store.setInstructions("user-authored");

    storage._data = "garbage" as unknown as AgentSettings;
    store.reloadFromStorage();

    expect(store.get()).toEqual({ reasoning_effort: "none", instructions: "user-authored" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — bootstrap keeps initial over a corrupted stored value
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — bootstrap keeps initial over a corrupted stored value", () => {
  it("does not adopt a corrupted stored value when initial is provided", () => {
    const storage: AgentStorage = {
      load: () => "garbage" as unknown as AgentSettings,
      save: vi.fn(),
    };
    const store = createAgentSettings({
      storage,
      initial: { reasoning_effort: "medium", instructions: "user-authored" },
    });
    expect(store.get()).toEqual({ reasoning_effort: "medium", instructions: "user-authored" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// localStorageAgentStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageAgentStorage", () => {
  it("default key is 'yui.agent'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageAgentStorage();
    adapter.save({ reasoning_effort: "none", instructions: "" });
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
    adapter.save({ reasoning_effort: "none", instructions: "" });
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });
});
