/**
 * chat-history-store.test.ts — unified conversation transcript store.
 *
 * Pins the contract for src/io/chat-history-store.ts:
 *   createChatHistoryStore({ storage?, initial? }) store (append/get/clear/subscribe/reload/dispose)
 *   localStorageChatHistoryStorage(key?) localStorage adapter
 *   selectSendSuffix(entries, contextWindow) pure helper
 */

import { describe, expect, it, vi } from "vitest";
import type { ChatHistoryEntry, ChatHistoryStorage } from "./chat-history-store";
import {
  createChatHistoryStore,
  localStorageChatHistoryStorage,
  selectSendSuffix,
} from "./chat-history-store";

function entry(role: "user" | "assistant", text: string, ts: number): ChatHistoryEntry {
  return { role, text, ts };
}

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — append/get roundtrip
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — append/get", () => {
  it("starts empty when no storage or initial given", () => {
    const store = createChatHistoryStore();
    expect(store.get()).toEqual([]);
  });

  it("append adds an entry, get roundtrips it", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "hi", 1));
    expect(store.get()).toEqual([entry("user", "hi", 1)]);
  });

  it("append preserves insertion order across multiple entries", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "hi", 1));
    store.append(entry("assistant", "hello", 2));
    expect(store.get()).toEqual([entry("user", "hi", 1), entry("assistant", "hello", 2)]);
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "hi", 1));
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("uses initial when no storage is provided", () => {
    const store = createChatHistoryStore({ initial: [entry("user", "seed", 1)] });
    expect(store.get()).toEqual([entry("user", "seed", 1)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — rolling cap
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — rolling cap", () => {
  it("evicts the oldest entries once the cap is exceeded", () => {
    const store = createChatHistoryStore();
    const CAP = 200;
    for (let i = 0; i < CAP + 10; i++) {
      store.append(entry("user", `msg-${i}`, i));
    }
    const got = store.get();
    expect(got.length).toBe(CAP);
    // oldest 10 evicted — newest entries kept
    expect(got[0]).toEqual(entry("user", "msg-10", 10));
    expect(got[got.length - 1]).toEqual(entry("user", `msg-${CAP + 9}`, CAP + 9));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — clear
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — clear", () => {
  it("empties the store", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "hi", 1));
    store.clear();
    expect(store.get()).toEqual([]);
  });

  it("is a no-op (no notify) when already empty", () => {
    const store = createChatHistoryStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).not.toHaveBeenCalled();
  });

  it("persists the cleared state via storage.save", () => {
    const storage: ChatHistoryStorage = { load: () => null, save: vi.fn() };
    const store = createChatHistoryStore({ storage });
    store.append(entry("user", "hi", 1));
    store.clear();
    expect(storage.save).toHaveBeenLastCalledWith([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — persist + reload via fake storage
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): ChatHistoryStorage & { _data: ChatHistoryEntry[] | null } {
  let data: ChatHistoryEntry[] | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: ChatHistoryEntry[] | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = s.map((e) => ({ ...e }));
    },
  };
}

describe("createChatHistoryStore — persist + reload", () => {
  it("append persists via storage.save", () => {
    const storage = makeMemStorage();
    const store = createChatHistoryStore({ storage });
    store.append(entry("user", "hi", 1));
    expect(storage._data).toEqual([entry("user", "hi", 1)]);
  });

  it("reloadFromStorage adopts an externally-changed stored value and notifies", () => {
    const storage = makeMemStorage();
    const store = createChatHistoryStore({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = [entry("assistant", "from other window", 5)];
    store.reloadFromStorage();

    expect(store.get()).toEqual([entry("assistant", "from other window", 5)]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("a second store reading the same storage sees persisted entries", () => {
    const storage = makeMemStorage();
    const store1 = createChatHistoryStore({ storage });
    store1.append(entry("user", "hi", 1));

    const store2 = createChatHistoryStore({ storage });
    expect(store2.get()).toEqual([entry("user", "hi", 1)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — malformed stored entries dropped
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — malformed stored entries dropped", () => {
  it("drops entries with a bad role", () => {
    const storage: ChatHistoryStorage = {
      load: () => [{ role: "system", text: "x", ts: 1 }] as unknown as ChatHistoryEntry[],
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([]);
  });

  it("drops entries with non-string text", () => {
    const storage: ChatHistoryStorage = {
      load: () => [{ role: "user", text: 123, ts: 1 }] as unknown as ChatHistoryEntry[],
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([]);
  });

  it("drops entries with non-number ts", () => {
    const storage: ChatHistoryStorage = {
      load: () => [{ role: "user", text: "hi", ts: "later" }] as unknown as ChatHistoryEntry[],
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([]);
  });

  it("keeps valid entries alongside dropped malformed ones", () => {
    const storage: ChatHistoryStorage = {
      load: () =>
        [
          { role: "user", text: "good", ts: 1 },
          { role: "bogus", text: "bad", ts: 2 },
          { role: "assistant", text: "also good", ts: 3 },
        ] as unknown as ChatHistoryEntry[],
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([entry("user", "good", 1), entry("assistant", "also good", 3)]);
  });

  it("non-array stored value falls back to empty", () => {
    const storage: ChatHistoryStorage = {
      load: () => ({ not: "an array" }) as unknown as ChatHistoryEntry[],
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([]);
  });

  it("storage.load() throwing falls back to empty", () => {
    const storage: ChatHistoryStorage = {
      load: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createChatHistoryStore();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.append(entry("user", "a", 1));
    unsub();
    store.append(entry("user", "b", 2));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createChatHistoryStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.append(entry("user", "a", 1));
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageChatHistoryStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageChatHistoryStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageChatHistoryStorage();
    adapter.save([entry("user", "hi", 1)]);
    expect(adapter.load()).toEqual([entry("user", "hi", 1)]);

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.chat_transcript'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageChatHistoryStorage();
    adapter.save([]);
    expect(written[0][0]).toBe("yui.chat_transcript");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageChatHistoryStorage("my.key");
    adapter.save([]);
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageChatHistoryStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save([])).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectSendSuffix
// ─────────────────────────────────────────────────────────────────────────────

describe("selectSendSuffix", () => {
  it("returns all entries when contextWindow is null/undefined/0", () => {
    const entries = [entry("user", "a", 1), entry("assistant", "b", 2)];
    expect(selectSendSuffix(entries, null)).toEqual(entries);
    expect(selectSendSuffix(entries, undefined)).toEqual(entries);
    expect(selectSendSuffix(entries, 0)).toEqual(entries);
  });

  it("returns all entries when they all fit the window", () => {
    // "hi" (2 chars) -> ceil(2/4) = 1 token estimate each
    const entries = [entry("user", "hi", 1), entry("assistant", "hi", 2)];
    expect(selectSendSuffix(entries, 100)).toEqual(entries);
  });

  it("keeps the newest suffix that fits, dropping the oldest", () => {
    // each entry text is 8 chars -> ceil(8/4) = 2 tokens
    const entries = [
      entry("user", "aaaaaaaa", 1),
      entry("assistant", "bbbbbbbb", 2),
      entry("user", "cccccccc", 3),
    ];
    // budget 4 fits exactly the newest 2 entries (2+2), not the oldest
    expect(selectSendSuffix(entries, 4)).toEqual([entries[1], entries[2]]);
  });

  it("returns an empty array when even the newest entry does not fit", () => {
    const entries = [entry("user", "aaaaaaaa", 1)];
    expect(selectSendSuffix(entries, 1)).toEqual([]);
  });

  it("returns an empty array for an empty entries array regardless of window", () => {
    expect(selectSendSuffix([], 100)).toEqual([]);
    expect(selectSendSuffix([], null)).toEqual([]);
  });
});
