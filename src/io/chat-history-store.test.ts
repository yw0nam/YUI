/**
 * chat-history-store.test.ts — unified conversation transcript store.
 *
 * Pins the contract for src/io/chat-history-store.ts:
 *   createChatHistoryStore({ storage?, initial? }) store
 *     (append/get/startNewSession/sessionToken/entriesAfterLastBoundary/sessions/subscribe/reload/dispose)
 *   localStorageChatHistoryStorage(key?) localStorage adapter
 *   selectSendSuffix(entries, contextWindow) pure helper
 */

import { describe, expect, it, vi } from "vitest";
import type { ChatHistoryEntry, ChatHistoryItem, ChatHistoryStorage } from "./chat-history-store";
import {
  createChatHistoryStore,
  estimateTokens,
  localStorageChatHistoryStorage,
  selectSendSuffix,
} from "./chat-history-store";

function entry(role: "user" | "assistant", text: string, ts: number): ChatHistoryEntry {
  return { role, text, ts };
}

function boundary(ts: number) {
  return { kind: "boundary" as const, ts };
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

  it("counts boundaries toward the cap", () => {
    const store = createChatHistoryStore();
    const CAP = 200;
    for (let i = 0; i < CAP; i++) store.append(entry("user", `msg-${i}`, i));
    store.startNewSession(9999);

    const got = store.get();
    expect(got.length).toBe(CAP);
    expect(got[got.length - 1]).toEqual(boundary(9999));
    // The oldest entry made room for the boundary.
    expect(got[0]).toEqual(entry("user", "msg-1", 1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — session boundaries
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — startNewSession", () => {
  it("appends a boundary marker instead of clearing the transcript", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "hi", 1));
    store.startNewSession(2);

    expect(store.get()).toEqual([entry("user", "hi", 1), boundary(2)]);
  });

  it("is a no-op when the transcript is empty", () => {
    const store = createChatHistoryStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.startNewSession(2);

    expect(store.get()).toEqual([]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("is a no-op when the last item is already a boundary", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "hi", 1));
    store.startNewSession(2);
    store.startNewSession(3);

    expect(store.get()).toEqual([entry("user", "hi", 1), boundary(2)]);
  });

  it("persists the boundary via storage.save", () => {
    const storage: ChatHistoryStorage = { load: () => null, save: vi.fn() };
    const store = createChatHistoryStore({ storage });
    store.append(entry("user", "hi", 1));
    store.startNewSession(2);

    expect(storage.save).toHaveBeenLastCalledWith([entry("user", "hi", 1), boundary(2)]);
  });

  it("keeps a stored boundary across a store reload", () => {
    const storage = makeMemStorage();
    const store1 = createChatHistoryStore({ storage });
    store1.append(entry("user", "hi", 1));
    store1.startNewSession(2);
    store1.append(entry("user", "fresh", 3));

    const store2 = createChatHistoryStore({ storage });
    expect(store2.get()).toEqual([entry("user", "hi", 1), boundary(2), entry("user", "fresh", 3)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — entriesAfterLastBoundary (replay source)
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — entriesAfterLastBoundary", () => {
  it("returns every entry when no boundary was ever written", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "a", 1));
    store.append(entry("assistant", "b", 2));

    expect(store.entriesAfterLastBoundary()).toEqual([
      entry("user", "a", 1),
      entry("assistant", "b", 2),
    ]);
  });

  it("returns only the entries appended after the latest boundary", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "old", 1));
    store.startNewSession(2);
    store.append(entry("user", "new", 3));
    store.append(entry("assistant", "reply", 4));

    expect(store.entriesAfterLastBoundary()).toEqual([
      entry("user", "new", 3),
      entry("assistant", "reply", 4),
    ]);
  });

  it("returns an empty array right after a boundary", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "old", 1));
    store.startNewSession(2);

    expect(store.entriesAfterLastBoundary()).toEqual([]);
  });

  it("ignores boundaries older than the latest one", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "one", 1));
    store.startNewSession(2);
    store.append(entry("user", "two", 3));
    store.startNewSession(4);
    store.append(entry("user", "three", 5));

    expect(store.entriesAfterLastBoundary()).toEqual([entry("user", "three", 5)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — sessionToken (mid-flight reset detection)
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — sessionToken", () => {
  it("is stable across appends", () => {
    const store = createChatHistoryStore();
    const before = store.sessionToken();
    store.append(entry("user", "hi", 1));
    store.append(entry("assistant", "there", 2));

    expect(store.sessionToken()).toBe(before);
  });

  it("changes when a reset closes a session", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "hi", 1));
    const before = store.sessionToken();
    store.startNewSession(2);

    expect(store.sessionToken()).not.toBe(before);
  });

  it("changes when a reset closes an empty session (no boundary written)", () => {
    const store = createChatHistoryStore();
    const before = store.sessionToken();
    store.startNewSession(2);

    expect(store.get()).toEqual([]);
    expect(store.sessionToken()).not.toBe(before);
  });

  // Cross-window delivery is asynchronous (storage event / debounced broadcast), so the token
  // must not wait for it — these read the token with no reload of their own.
  it("changes when another window's reset lands in storage, before any sync arrives", () => {
    const storage = makeMemStorage();
    const store = createChatHistoryStore({ storage });
    store.append(entry("user", "hi", 1));
    const before = store.sessionToken();

    createChatHistoryStore({ storage }).startNewSession(2);

    expect(store.sessionToken()).not.toBe(before);
  });

  it("is unchanged by another window's append", () => {
    const storage = makeMemStorage();
    const store = createChatHistoryStore({ storage });
    store.append(entry("user", "hi", 1));
    const before = store.sessionToken();

    createChatHistoryStore({ storage }).append(entry("assistant", "there", 2));

    expect(store.sessionToken()).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — sessions (viewer source)
// ─────────────────────────────────────────────────────────────────────────────

describe("createChatHistoryStore — sessions", () => {
  it("groups a boundary-free transcript as one session starting at its first entry", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "a", 10));
    store.append(entry("assistant", "b", 20));

    expect(store.sessions()).toEqual([
      { startedAt: 10, entries: [entry("user", "a", 10), entry("assistant", "b", 20)] },
    ]);
  });

  it("returns sessions newest-first, each starting at its boundary timestamp", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "old", 10));
    store.startNewSession(50);
    store.append(entry("user", "new", 60));

    expect(store.sessions()).toEqual([
      { startedAt: 50, entries: [entry("user", "new", 60)] },
      { startedAt: 10, entries: [entry("user", "old", 10)] },
    ]);
  });

  it("keeps the current session even when it has no entries yet", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "old", 10));
    store.startNewSession(50);

    const sessions = store.sessions();
    expect(sessions[0]).toEqual({ startedAt: 50, entries: [] });
    expect(sessions).toHaveLength(2);
  });

  it("drops older empty sessions left by a leading orphan boundary", () => {
    const storage: ChatHistoryStorage = {
      load: () => [boundary(5), entry("user", "a", 10)] as never,
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });

    expect(store.sessions()).toEqual([{ startedAt: 5, entries: [entry("user", "a", 10)] }]);
  });

  it("reports a single empty session with no start time for an empty transcript", () => {
    const store = createChatHistoryStore();
    expect(store.sessions()).toEqual([{ startedAt: null, entries: [] }]);
  });

  it("returns copies — mutating the result does not affect the store", () => {
    const store = createChatHistoryStore();
    store.append(entry("user", "a", 10));
    const sessions = store.sessions();
    sessions[0].entries[0].text = "tampered";

    expect(store.sessions()[0].entries[0].text).toBe("a");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChatHistoryStore — persist + reload via fake storage
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): ChatHistoryStorage & { _data: ChatHistoryItem[] | null } {
  let data: ChatHistoryItem[] | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: ChatHistoryItem[] | null) {
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

  it("append preserves another window's persisted entry when local memory is stale", () => {
    const storage = makeMemStorage();
    const storeA = createChatHistoryStore({ storage });
    const storeB = createChatHistoryStore({ storage });

    storeA.append(entry("user", "from A", 1));
    storeB.append(entry("assistant", "from B", 2));
    storeA.append(entry("user", "from A again", 3));

    expect(storage._data).toEqual([
      entry("user", "from A", 1),
      entry("assistant", "from B", 2),
      entry("user", "from A again", 3),
    ]);
    expect(storeA.get()).toEqual(storage._data);
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

  it("keeps stored boundary markers alongside entries", () => {
    const storage: ChatHistoryStorage = {
      load: () => [entry("user", "a", 1), boundary(2), entry("assistant", "b", 3)] as never,
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([entry("user", "a", 1), boundary(2), entry("assistant", "b", 3)]);
  });

  it("drops boundary markers with a non-number ts", () => {
    const storage: ChatHistoryStorage = {
      load: () => [{ kind: "boundary", ts: "later" }, entry("user", "a", 1)] as never,
      save: vi.fn(),
    };
    const store = createChatHistoryStore({ storage });
    expect(store.get()).toEqual([entry("user", "a", 1)]);
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

  it("drops an older CJK entry that the old chars/4 formula would have kept", () => {
    // 10 Hangul syllables: old chars/4 estimate = ceil(10/4) = 3 per entry (6
    // total for both, fits budget 10). CJK-weighted estimate = 10 per entry
    // (20 total), so only the newest entry fits budget 10.
    const cjk10 = "가".repeat(10);
    const entries = [entry("user", cjk10, 1), entry("assistant", cjk10, 2)];
    expect(selectSendSuffix(entries, 10)).toEqual([entries[1]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// estimateTokens
// ─────────────────────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("estimates plain ASCII/English text as chars/4 (unchanged baseline)", () => {
    expect(estimateTokens("aaaaaaaa")).toBe(2);
    expect(estimateTokens("hello world")).toBe(Math.ceil("hello world".length / 4));
  });

  it("estimates Korean (Hangul) text at ~1 token per char, well above chars/4", () => {
    const text = "안녕하세요오늘도좋은하루되세요";
    const oldEstimate = Math.ceil(text.length / 4);
    const newEstimate = estimateTokens(text);
    expect(newEstimate).toBe(text.length);
    expect(newEstimate).toBeGreaterThanOrEqual(oldEstimate * 2);
  });

  it("estimates Japanese (hiragana/katakana/kanji) text at ~1 token per char", () => {
    const text = "こんにちは今日もいい天気ですね";
    const oldEstimate = Math.ceil(text.length / 4);
    const newEstimate = estimateTokens(text);
    expect(newEstimate).toBe(text.length);
    expect(newEstimate).toBeGreaterThanOrEqual(oldEstimate * 2);
  });

  it("estimates full-width forms as CJK-weighted", () => {
    const text = "ＡＢＣＤ";
    expect(estimateTokens(text)).toBe(text.length);
  });

  it("estimates mixed CJK + ASCII text as the sum of per-script weights", () => {
    // "Hello " = 6 ascii chars -> 6/4; "안녕" = 2 hangul chars -> 2
    const text = "Hello 안녕";
    expect(estimateTokens(text)).toBe(Math.ceil(2 + 6 / 4));
  });

  it("returns 0 for an empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts an astral-plane emoji (surrogate pair) as one non-CJK char, not two", () => {
    // "😀" is a single code point encoded as a UTF-16 surrogate pair (length 2
    // in JS string indexing). Iterating with for-of must treat it as ONE char.
    const emoji = "😀";
    expect([...emoji].length).toBe(1);
    expect(emoji.length).toBe(2);
    expect(estimateTokens(emoji)).toBe(Math.ceil(1 / 4));
  });
});
