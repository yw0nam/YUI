/**
 * Persisted per-turn signal records — one row per signal group a turn ran with, kept per preset
 * beside the transcript so History can fold each turn's groups under its reply.
 */

import {
  createPersistedStore,
  localStorageStore,
  type PersistedStorage,
} from "../../../settings/persisted-store";

export interface SignalRecord {
  turn_id: string;
  source: string;
  event_type: string;
  label: string | null;
  delivery: "urgent" | "batched";
  ts: number;
  /** What YUI said on that turn — null while silent or not yet known. */
  said: string | null;
}

export type SignalHistoryStorage = PersistedStorage<SignalRecord[]>;

// ponytail: fixed cap, tune if localStorage pressure appears.
const MAX_RECORDS = 200;

function coerceRecord(v: unknown): SignalRecord | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.turn_id !== "string") return null;
  if (typeof r.source !== "string") return null;
  if (typeof r.event_type !== "string") return null;
  if (r.label !== null && typeof r.label !== "string") return null;
  if (typeof r.ts !== "number") return null;
  if (r.said !== null && typeof r.said !== "string") return null;
  return {
    turn_id: r.turn_id,
    source: r.source,
    event_type: r.event_type,
    label: r.label,
    // immediate is deprecated but still sits in stored rows of an older release.
    delivery: r.delivery === "urgent" ? "urgent" : "batched",
    ts: r.ts,
    said: r.said,
  };
}

function coerce(v: unknown): SignalRecord[] {
  if (!Array.isArray(v)) return [];
  const out: SignalRecord[] = [];
  for (const item of v) {
    const coerced = coerceRecord(item);
    if (coerced) out.push(coerced);
  }
  return out;
}

function equalRecords(a: SignalRecord[], b: SignalRecord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => {
    const other = b[i]!;
    return (
      r.turn_id === other.turn_id &&
      r.source === other.source &&
      r.event_type === other.event_type &&
      r.label === other.label &&
      r.delivery === other.delivery &&
      r.ts === other.ts &&
      r.said === other.said
    );
  });
}

export function createSignalHistoryStore(opts?: { storage?: SignalHistoryStorage }) {
  const core = createPersistedStore<SignalRecord[]>({
    storage: opts?.storage,
    defaults: [],
    // A non-array, or a non-empty array that coerces to empty, is rejected so a corrupted
    // stored value cannot erase the in-memory history.
    parse: (v) => {
      if (!Array.isArray(v)) return null;
      const coerced = coerce(v);
      return v.length > 0 && coerced.length === 0 ? null : coerced;
    },
    equals: equalRecords,
    clone: (v) => v.map((r) => ({ ...r })),
  });

  return {
    append(records: SignalRecord[]): void {
      // The other window may have appended since the last sync — merge before committing.
      core.reloadFromStorage();
      const next = [...core.current(), ...records];
      core.commit(next.length <= MAX_RECORDS ? next : next.slice(next.length - MAX_RECORDS));
    },

    /** Fills what the turn said into its records that do not know it yet. */
    setSaid(turnId: string, text: string): void {
      let changed = false;
      const next = core.current().map((r) => {
        if (r.turn_id !== turnId || r.said !== null) return r;
        changed = true;
        return { ...r, said: text };
      });
      if (changed) core.commit(next);
    },

    /** Oldest first. */
    records(): SignalRecord[] {
      return core.get();
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

const SIGNAL_HISTORY_KEY = "yui.signal_history";

/** localStorage-backed adapter. Gracefully no-ops where localStorage is absent. */
export function localStorageSignalHistoryStorage(): SignalHistoryStorage {
  return localStorageStore<SignalRecord[]>(SIGNAL_HISTORY_KEY);
}
