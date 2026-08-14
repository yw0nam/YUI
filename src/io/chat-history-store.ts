/**
 * Unified conversation transcript — both protocol modes append to it; only
 * Chat Completions mode sends from it (Responses mode keeps state server-side
 * via previous_response_id). "Start fresh" writes a session boundary instead of
 * erasing history: replay reads entriesAfterLastBoundary(), the history viewer
 * reads sessions().
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

/** Divider between conversation sessions. Replay stops here; the viewer reads past it. */
export interface ChatHistoryBoundary {
  kind: "boundary";
  ts: number;
}

export type ChatHistoryItem = ChatHistoryEntry | ChatHistoryBoundary;

/** One conversation session: the turns between two boundaries. */
export interface ChatSession {
  /** Boundary that opened it, the first entry's ts for the oldest session, null when empty. */
  startedAt: number | null;
  entries: ChatHistoryEntry[];
}

export type ChatHistoryStorage = PersistedStorage<ChatHistoryItem[]>;

// ponytail: fixed cap, tune if localStorage pressure appears. Boundaries count as items.
const MAX_ITEMS = 200;

export function isBoundary(item: ChatHistoryItem): item is ChatHistoryBoundary {
  return "kind" in item;
}

/** Timestamp of the newest boundary; 0 when the transcript has none. */
function lastBoundaryTs(items: ChatHistoryItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (isBoundary(item)) return item.ts;
  }
  return 0;
}

function coerceItem(v: unknown): ChatHistoryItem | null {
  if (v === null || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (typeof e.ts !== "number") return null;
  if (e.kind === "boundary") return { kind: "boundary", ts: e.ts };
  if (e.role !== "user" && e.role !== "assistant") return null;
  if (typeof e.text !== "string") return null;
  return { role: e.role, text: e.text, ts: e.ts };
}

function coerce(v: unknown): ChatHistoryItem[] {
  if (!Array.isArray(v)) return [];
  const out: ChatHistoryItem[] = [];
  for (const item of v) {
    const coerced = coerceItem(item);
    if (coerced) out.push(coerced);
  }
  return out;
}

function equalItems(a: ChatHistoryItem[], b: ChatHistoryItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const other = b[i];
    if (isBoundary(item) || isBoundary(other)) {
      return isBoundary(item) && isBoundary(other) && item.ts === other.ts;
    }
    return item.role === other.role && item.text === other.text && item.ts === other.ts;
  });
}

export function createChatHistoryStore(opts?: {
  storage?: ChatHistoryStorage;
  initial?: ChatHistoryItem[];
}) {
  const core = createPersistedStore<ChatHistoryItem[]>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: [],
    parse: (v) => (v === null ? null : coerce(v)),
    fromInitial: coerce,
    equals: equalItems,
    clone: (v) => v.map((e) => ({ ...e })),
  });

  let localResets = 0;

  function push(item: ChatHistoryItem): void {
    // The other window may have appended since the last sync — merge before committing.
    core.reloadFromStorage();
    const next = [...core.current(), item];
    if (next.length <= MAX_ITEMS) {
      core.commit(next);
      return;
    }

    const sliceStart = next.length - MAX_ITEMS;
    const retained = next.slice(sliceStart);
    for (let i = next.length - 1; i >= 0; i--) {
      if (!isBoundary(next[i])) continue;
      if (i < sliceStart) retained[0] = next[i];
      break;
    }
    core.commit(retained);
  }

  return {
    get: core.get,

    append(entry: ChatHistoryEntry): void {
      push(entry);
    },

    /** Close the running session and open a new one. No-op when the current session is empty. */
    startNewSession(ts: number = Date.now()): void {
      localResets++;
      // The other window may have appended since the last sync — never write over its turns.
      core.reloadFromStorage();
      const items = core.current();
      const last = items[items.length - 1];
      if (last === undefined || isBoundary(last)) return;
      push({ kind: "boundary", ts });
    },

    /**
     * Identity of the running session — compare a value taken before a long operation with a
     * fresh one to tell whether a reset opened a new session meanwhile. Both halves carry: a
     * reset here counts even when it closes an empty session and writes no boundary, and a
     * reset in another window arrives only as a new boundary timestamp. Storage is re-read on
     * every call, since the other window's reset reaches this one asynchronously and a token
     * that waits for that sync reports a session that is already closed.
     *
     * Blind spot by design: another window resetting an *empty* session writes no boundary and
     * leaves nothing to observe (the counter is window-local). The same reset done here counts.
     */
    sessionToken(): string {
      core.reloadFromStorage();
      return `${localResets}:${lastBoundaryTs(core.current())}`;
    },

    /** Replay source — the current session's turns only. */
    entriesAfterLastBoundary(): ChatHistoryEntry[] {
      const items = core.current();
      let start = 0;
      for (let i = items.length - 1; i >= 0; i--) {
        if (isBoundary(items[i])) {
          start = i + 1;
          break;
        }
      }
      return items.slice(start).map((e) => ({ ...(e as ChatHistoryEntry) }));
    },

    /**
     * Viewer source — every session newest-first. The current session is always
     * present (even before its first turn); older empty sessions are dropped.
     */
    sessions(): ChatSession[] {
      const out: ChatSession[] = [];
      let openedAt: number | null = null;
      let entries: ChatHistoryEntry[] = [];
      const flush = (): void => {
        out.push({ startedAt: openedAt ?? entries[0]?.ts ?? null, entries });
      };
      for (const item of core.current()) {
        if (isBoundary(item)) {
          flush();
          openedAt = item.ts;
          entries = [];
        } else {
          entries.push({ ...item });
        }
      }
      flush();
      return out.filter((s, i) => i === out.length - 1 || s.entries.length > 0).reverse();
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed adapter. Gracefully no-ops where localStorage is absent. */
export function localStorageChatHistoryStorage(key = "yui.chat_transcript"): ChatHistoryStorage {
  return localStorageStore<ChatHistoryItem[]>(key);
}

// Code point ranges where one character is estimated at ~1 token: Hangul
// Jamo/Compatibility Jamo/Syllables, Hiragana/Katakana, CJK punctuation, CJK
// Unified Ideographs (+ Extension A), CJK Compatibility Ideographs, and
// full-width forms. Supplementary-plane Ext B+ (0x20000+) is skipped — rare
// enough in chat text that it's not worth the extra range for this heuristic.
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff],
  [0x3000, 0x303f],
  [0x3040, 0x30ff],
  [0x3130, 0x318f],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

function isCJKCodePoint(codePoint: number): boolean {
  return CJK_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/**
 * Token estimate with no tokenizer dependency: CJK characters (Hangul,
 * Hiragana/Katakana, CJK Unified Ideographs, full-width forms) cost ~1 token
 * each, everything else costs ~1/4 token (the old flat chars/4 rule).
 */
export function estimateTokens(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;
  for (const ch of text) {
    if (isCJKCodePoint(ch.codePointAt(0) ?? 0)) cjkCount++;
    else otherCount++;
  }
  return Math.ceil(cjkCount + otherCount / 4);
}

/**
 * Longest newest-first suffix of `entries` whose estimated token cost fits
 * `contextWindow`. The current turn is never included here — the caller
 * accounts for it separately.
 */
export function selectSendSuffix(
  entries: ChatHistoryEntry[],
  contextWindow: number | null | undefined,
): ChatHistoryEntry[] {
  if (!contextWindow) return entries;

  let budget = contextWindow;
  let start = entries.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    const cost = estimateTokens(entries[i].text);
    if (cost > budget) break;
    budget -= cost;
    start = i;
  }
  return entries.slice(start);
}
