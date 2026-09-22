/**
 * delegation-history — every delegation the client has seen, persisted in localStorage across
 * backend restarts. The live delegations list forgets on purpose; the settings window's Session
 * section reads this one instead.
 */

import {
  createPersistedStore,
  localStorageStore,
  type PersistedStorage,
} from "../../settings/persisted-store";
import type { DelegationItem } from "../chat/push-socket";
import { sanitizeDelegation } from "./delegations-store";

export const DELEGATION_HISTORY_MAX_ITEMS = 200;

export type DelegationHistoryStorage = PersistedStorage<DelegationItem[]>;

export interface DelegationHistory {
  /** Fold one `delegations` frame in: the frame's items replace their records by id, the rest stay. */
  merge(frame: DelegationItem[]): void;
  /** Running items first in the order seen, then done items newest first. */
  get(): DelegationItem[];
  subscribe(cb: (items: DelegationItem[]) => void): () => void;
  reloadFromStorage(): void;
  dispose(): void;
}

/** localStorage-backed adapter. Gracefully no-ops where localStorage is absent. */
export function localStorageDelegationHistoryStorage(
  key = "yui.delegation_history",
): DelegationHistoryStorage {
  return localStorageStore<DelegationItem[]>(key);
}

/** Index of the done record with the smallest `ended_at` (`undefined` counts as 0), or -1. */
function oldestDoneIndex(items: DelegationItem[]): number {
  let index = -1;
  let oldest = Infinity;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.state !== "done") continue;
    const ended = item.ended_at ?? 0;
    if (ended < oldest) {
      oldest = ended;
      index = i;
    }
  }
  return index;
}

/** Running in held order, then done newest first. */
function ordered(held: DelegationItem[]): DelegationItem[] {
  return [
    ...held.filter((item) => item.state === "running"),
    ...held
      .filter((item) => item.state !== "running")
      .sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0)),
  ];
}

export function createDelegationHistory(
  opts: { storage?: DelegationHistoryStorage; now?: () => number } = {},
): DelegationHistory {
  const now = opts.now ?? Date.now;
  const core = createPersistedStore<DelegationItem[]>({
    storage: opts.storage ?? localStorageDelegationHistoryStorage(),
    defaults: [],
    // A corrupted stored value must not erase the in-memory list, so reject what sanitizes to nothing.
    parse: (v) => {
      if (!Array.isArray(v)) return null;
      const sanitized = v
        .map(sanitizeDelegation)
        .filter((item): item is DelegationItem => item !== null);
      return v.length > 0 && sanitized.length === 0 ? null : sanitized;
    },
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone: (v) => v.map((item) => ({ ...item })),
  });

  function get(): DelegationItem[] {
    return ordered(core.get());
  }

  return {
    merge(frame): void {
      const held = [...core.current()];
      const listed = new Set<string>();
      for (const raw of frame) {
        const item = sanitizeDelegation(raw);
        if (item === null) continue;
        listed.add(item.id);
        const index = held.findIndex((record) => record.id === item.id);
        if (index >= 0) held[index] = item;
        else held.push(item);
      }
      // A frame lists every delegation of the conversation, so a running one it leaves out ended without a report.
      for (let i = 0; i < held.length; i++) {
        const record = held[i]!;
        if (record.state === "running" && !listed.has(record.id)) {
          held[i] = { ...record, state: "done", ended_at: now(), status: "unknown" };
        }
      }
      while (held.length > DELEGATION_HISTORY_MAX_ITEMS) {
        const index = oldestDoneIndex(held);
        if (index < 0) break;
        held.splice(index, 1);
      }
      core.commit(held);
    },

    get,

    subscribe(cb: (items: DelegationItem[]) => void): () => void {
      return core.subscribe(() => cb(get()));
    },

    reloadFromStorage: core.reloadFromStorage,
    dispose: core.dispose,
  };
}
