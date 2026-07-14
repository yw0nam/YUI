/**
 * chat-key-settings.test.ts — chat API key override reactive store.
 *
 * Pins the contract for src/io/chat-key-settings.ts:
 *   CHAT_KEY_MAX_LEN cap
 *   createChatKeySettings({ storage?, initial? }) store (get / setApiKey / clear /
 *     subscribe / reloadFromStorage / dispose)
 *   localStorageChatKeyStorage(key?) localStorage adapter
 *
 * The key value is a secret — assertions check persistence/notification shape, never log it.
 */

import { describe, expect, it, vi } from "vitest";
import type { ChatKeySettings, ChatKeyStorage } from "./chat-key-settings";
import {
  CHAT_KEY_MAX_LEN,
  createChatKeySettings,
  localStorageChatKeyStorage,
} from "./chat-key-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("chat-key-settings constants", () => {
  it("CHAT_KEY_MAX_LEN is a positive integer", () => {
    expect(Number.isInteger(CHAT_KEY_MAX_LEN)).toBe(true);
    expect(CHAT_KEY_MAX_LEN).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatKeySettings — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatKeySettings — defaults", () => {
  it("returns empty apiKey (no override) when no storage or initial given", () => {
    const store = createChatKeySettings();
    expect(store.get().apiKey).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatKeySettings — setApiKey + subscribers
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatKeySettings — setApiKey", () => {
  it("setApiKey updates get().apiKey", () => {
    const store = createChatKeySettings();
    store.setApiKey("sk-test");
    expect(store.get().apiKey).toBe("sk-test");
  });

  it("notifies subscribers with a fresh copy", () => {
    const store = createChatKeySettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setApiKey("sk-test");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("trims surrounding whitespace", () => {
    const store = createChatKeySettings();
    store.setApiKey("  sk-test  ");
    expect(store.get().apiKey).toBe("sk-test");
  });

  it("a whitespace-only value trims to empty (no override)", () => {
    const store = createChatKeySettings();
    store.setApiKey("   ");
    expect(store.get().apiKey).toBe("");
  });

  it("caps absurdly long values to CHAT_KEY_MAX_LEN", () => {
    const store = createChatKeySettings();
    store.setApiKey("x".repeat(CHAT_KEY_MAX_LEN + 5000));
    expect(store.get().apiKey.length).toBe(CHAT_KEY_MAX_LEN);
  });

  it("ignores non-string input — apiKey stays empty and no notification", () => {
    const store = createChatKeySettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setApiKey(123 as unknown as string);
    expect(store.get().apiKey).toBe("");
    expect(cb).not.toHaveBeenCalled();
  });

  it("dedup: setting the same value twice notifies only once", () => {
    const store = createChatKeySettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setApiKey("sk-test");
    store.setApiKey("sk-test");
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatKeySettings — clear
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatKeySettings — clear", () => {
  it("clear() removes the override (apiKey becomes empty)", () => {
    const store = createChatKeySettings();
    store.setApiKey("sk-test");
    store.clear();
    expect(store.get().apiKey).toBe("");
  });

  it("clear() notifies subscribers with empty apiKey", () => {
    const store = createChatKeySettings();
    store.setApiKey("sk-test");
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ apiKey: "" });
  });

  it("clear() on an already-empty store is a no-op (no notify)", () => {
    const store = createChatKeySettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatKeySettings — subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// createChatKeySettings — storage persistence
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): ChatKeyStorage & { _data: ChatKeySettings | null } {
  let data: ChatKeySettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: ChatKeySettings | null) {
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

describe("createChatKeySettings — persistence", () => {
  it("setApiKey calls storage.save with the new settings", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createChatKeySettings({ storage });
    store.setApiKey("sk-test");
    expect(saveSpy).toHaveBeenCalledWith({ apiKey: "sk-test" });
  });

  it("clear() persists the empty override", () => {
    const storage = makeMemStorage();
    const store = createChatKeySettings({ storage });
    store.setApiKey("sk-test");
    store.clear();
    expect(storage._data).toEqual({ apiKey: "" });
  });

  it("a new store created with same storage loads the persisted apiKey", () => {
    const storage = makeMemStorage();
    const store1 = createChatKeySettings({ storage });
    store1.setApiKey("sk-test");

    const store2 = createChatKeySettings({ storage });
    expect(store2.get().apiKey).toBe("sk-test");
  });

  it("stored invalid type {apiKey:123} falls back to empty", () => {
    const storage: ChatKeyStorage = {
      load: () => ({ apiKey: 123 }) as unknown as ChatKeySettings,
      save: vi.fn(),
    };
    const store = createChatKeySettings({ storage });
    expect(store.get().apiKey).toBe("");
  });

  it("never throws when storage.save() throws", () => {
    const storage: ChatKeyStorage = {
      load: () => null,
      save: () => {
        throw new Error("boom");
      },
    };
    const store = createChatKeySettings({ storage });
    expect(() => store.setApiKey("sk-test")).not.toThrow();
    expect(store.get().apiKey).toBe("sk-test");
  });

  it("stored value out of range is capped on load", () => {
    const storage: ChatKeyStorage = {
      load: () => ({ apiKey: "x".repeat(CHAT_KEY_MAX_LEN + 5000) }),
      save: vi.fn(),
    };
    const store = createChatKeySettings({ storage });
    expect(store.get().apiKey.length).toBe(CHAT_KEY_MAX_LEN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageChatKeyStorage — adapter
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageChatKeyStorage", () => {
  it("default key is 'yui.chat-key'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageChatKeyStorage();
    adapter.save({ apiKey: "sk-test" });
    expect(written[0][0]).toBe("yui.chat-key");

    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
