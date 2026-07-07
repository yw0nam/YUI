/**
 * Unified conversation transcript — both protocol modes append to it; only
 * Chat Completions mode sends from it (Responses mode keeps state server-side
 * via previous_response_id). Also feeds a future history-viewer UI via
 * get()/subscribe().
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

export type ChatHistoryStorage = PersistedStorage<ChatHistoryEntry[]>;

// ponytail: fixed cap, tune if localStorage pressure appears
const MAX_ENTRIES = 200;

function coerceEntry(v: unknown): ChatHistoryEntry | null {
  if (v === null || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (e.role !== "user" && e.role !== "assistant") return null;
  if (typeof e.text !== "string") return null;
  if (typeof e.ts !== "number") return null;
  return { role: e.role, text: e.text, ts: e.ts };
}

function coerce(v: unknown): ChatHistoryEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ChatHistoryEntry[] = [];
  for (const item of v) {
    const entry = coerceEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

function equalEntries(a: ChatHistoryEntry[], b: ChatHistoryEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => e.role === b[i].role && e.text === b[i].text && e.ts === b[i].ts);
}

export function createChatHistoryStore(opts?: {
  storage?: ChatHistoryStorage;
  initial?: ChatHistoryEntry[];
}) {
  const core = createPersistedStore<ChatHistoryEntry[]>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: [],
    parse: (v) => (v === null ? null : coerce(v)),
    fromInitial: coerce,
    equals: equalEntries,
    clone: (v) => v.map((e) => ({ ...e })),
  });

  return {
    get: core.get,

    append(entry: ChatHistoryEntry): void {
      const next = [...core.current(), entry];
      core.commit(next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next);
    },

    clear(): void {
      core.commit([]);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed adapter. Gracefully no-ops where localStorage is absent. */
export function localStorageChatHistoryStorage(key = "yui.chat_transcript"): ChatHistoryStorage {
  return localStorageStore<ChatHistoryEntry[]>(key);
}

// Code point ranges where one character is estimated at ~1 token: Hangul
// Jamo/Compatibility Jamo/Syllables, Hiragana/Katakana, CJK Unified
// Ideographs (+ Extension A), and full-width forms.
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff],
  [0x3040, 0x30ff],
  [0x3130, 0x318f],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7a3],
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
