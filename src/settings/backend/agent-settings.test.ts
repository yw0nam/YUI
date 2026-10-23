/**
 * agent-settings.test.ts — AI agent request-shaping reactive store.
 *
 * Pins the contract for src/settings/backend/agent-settings.ts:
 *   REASONING_EFFORTS constant
 *   createAgentSettings({ storage? }) store
 *   localStorageAgentStorage(key?) localStorage adapter
 */

import { describe, expect, it, vi } from "vitest";
import { type Card, EMPTY_CARD } from "../../config/validators/persona/types";
import type { AgentSettings, AgentStorage } from "./agent-settings";
import { createAgentSettings, localStorageAgentStorage, REASONING_EFFORTS } from "./agent-settings";

const DEFAULTS = { reasoning_effort: "none", send_card: true, card: null };
const OWN: Card = { ...EMPTY_CARD, name: "Mira", alternate_greetings: ["Evening."], tags: [] };

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("agent-settings constants", () => {
  it("REASONING_EFFORTS is the expected ordered list", () => {
    expect(REASONING_EFFORTS).toEqual(["none", "minimal", "low", "medium"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — defaults", () => {
  it("returns default state when no storage given", () => {
    const store = createAgentSettings();
    expect(store.get()).toEqual(DEFAULTS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — load coercion
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — load coercion", () => {
  it("coerces invalid stored reasoning_effort to 'none'", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "bogus" }) as unknown as AgentSettings,
      save: vi.fn(),
    };
    expect(createAgentSettings({ storage }).get().reasoning_effort).toBe("none");
  });

  it("reads a stored instructions string as an own card and never writes it back", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "low", instructions: "be terse" }) as never,
      save: vi.fn(),
    };
    const store = createAgentSettings({ storage });
    expect(store.get().card).toEqual({ ...EMPTY_CARD, system_prompt: "be terse" });

    store.setReasoningEffort("medium");
    const saved = vi.mocked(storage.save).mock.calls[0][0];
    expect(saved).not.toHaveProperty("instructions");
    expect(saved.card?.system_prompt).toBe("be terse");
  });

  it("reads an empty stored instructions string as the default card", () => {
    const storage: AgentStorage = {
      load: () => ({ reasoning_effort: "none", instructions: "" }) as never,
      save: vi.fn(),
    };
    expect(createAgentSettings({ storage }).get()).toEqual(DEFAULTS);
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
    expect(cb).toHaveBeenCalledWith({ ...DEFAULTS, reasoning_effort: "medium" });
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("persists via storage.save", () => {
    const storage: AgentStorage = { load: () => null, save: vi.fn() };
    const store = createAgentSettings({ storage });
    store.setReasoningEffort("medium");
    expect(storage.save).toHaveBeenCalledWith({ ...DEFAULTS, reasoning_effort: "medium" });
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
    const store = createAgentSettings();
    store.setReasoningEffort("medium");
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
// createAgentSettings — card
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — card", () => {
  it("a set card round-trips through storage", () => {
    const storage = makeMemStorage();
    createAgentSettings({ storage }).setCard(OWN);
    expect(createAgentSettings({ storage }).get().card).toEqual(OWN);
  });

  it("updateCard patches a copy of the base while the card is the default", () => {
    const store = createAgentSettings();
    store.updateCard({ scenario: "rain" }, OWN);
    expect(store.get().card).toEqual({ ...OWN, scenario: "rain" });
    store.updateCard({ name: "Ren" }, EMPTY_CARD);
    expect(store.get().card).toEqual({ ...OWN, scenario: "rain", name: "Ren" });
  });

  it("resetCard returns to the default card", () => {
    const store = createAgentSettings();
    store.setCard(OWN);
    store.resetCard();
    expect(store.get().card).toBeNull();
  });

  it("setSendCard persists the switch", () => {
    const storage = makeMemStorage();
    createAgentSettings({ storage }).setSendCard(false);
    expect(createAgentSettings({ storage }).get().send_card).toBe(false);
  });

  it("mutating a returned card leaves the store unchanged", () => {
    const store = createAgentSettings();
    store.setCard(OWN);
    store.get().card?.alternate_greetings.push("Hi.");
    expect(store.get().card?.alternate_greetings).toEqual(["Evening."]);
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
      data = structuredClone(s);
    },
  };
}

describe("createAgentSettings — reloadFromStorage", () => {
  it("coerces invalid stored values on reload", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    storage._data = { reasoning_effort: "bogus", card: 9 } as unknown as AgentSettings;
    store.reloadFromStorage();
    expect(store.get()).toEqual(DEFAULTS);
  });

  it("keeps the in-memory card when the stored value is corrupted", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    store.setCard(OWN);

    storage._data = "garbage" as unknown as AgentSettings;
    store.reloadFromStorage();

    expect(store.get()).toEqual({ ...DEFAULTS, card: OWN });
  });

  it("keeps the in-memory card when the stored value is an array", () => {
    const storage = makeMemStorage();
    const store = createAgentSettings({ storage });
    store.setCard(OWN);

    storage._data = [] as unknown as AgentSettings;
    store.reloadFromStorage();

    expect(store.get()).toEqual({ ...DEFAULTS, card: OWN });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgentSettings — bootstrap rejects a corrupted stored value
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgentSettings — bootstrap rejects a corrupted stored value", () => {
  it("falls back to the default state", () => {
    const load = vi.fn(() => "garbage" as unknown as AgentSettings);
    const storage: AgentStorage = { load, save: vi.fn() };
    expect(createAgentSettings({ storage }).get()).toEqual(DEFAULTS);
    expect(load).toHaveBeenCalled();
  });
});

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
    adapter.save({ reasoning_effort: "none", send_card: true, card: null });
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
    adapter.save({ reasoning_effort: "none", send_card: true, card: null });
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });
});
