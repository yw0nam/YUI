/**
 * Collapsed-state store for Quick Controls sections — the panel's native `<details>` groups.
 *
 * Stored as the *closed* set, keyed by each section's stable `data-section` id, so a section
 * absent from the set renders open (matches today's always-expanded layout).
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface SectionsSettings {
  /** Ids of sections collapsed by the user. Ids outside the current vocabulary are ignored on read. */
  closed: string[];
}

export type SectionsStorage = PersistedStorage<SectionsSettings>;

function isValidSettings(v: unknown): v is SectionsSettings {
  if (v === null || typeof v !== "object") return false;
  const { closed } = v as Record<string, unknown>;
  return Array.isArray(closed) && closed.every((id) => typeof id === "string");
}

export function createSectionsSettings(opts?: {
  storage?: SectionsStorage;
  initial?: SectionsSettings;
}) {
  const core = createPersistedStore<SectionsSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { closed: [] },
    parse: (v) => (isValidSettings(v) ? { closed: [...new Set(v.closed)] } : null),
    equals: (a, b) =>
      a.closed.length === b.closed.length && a.closed.every((id, i) => id === b.closed[i]),
    clone: (v) => ({ closed: [...v.closed] }),
  });

  return {
    get: core.get,

    setClosed(id: string, closed: boolean): void {
      const current = core.current().closed;
      const has = current.includes(id);
      if (closed === has) return;
      core.commit({
        closed: closed ? [...current, id] : current.filter((x) => x !== id),
      });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type SectionsSettingsStore = ReturnType<typeof createSectionsSettings>;

/** localStorage-backed SectionsStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageSectionsStorage(key = "yui.sections"): SectionsStorage {
  return localStorageStore<SectionsSettings>(key);
}
