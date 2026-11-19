/**
 * Active hours settings — reactive store.
 * Persists to localStorage(key "yui.active-hours"), notifies subscribers on change.
 *
 * Priority: stored > defaults ({ spans: null } — the card's spans then apply).
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "../persisted-store";
import { isValidSpans, type Span } from "./spans";

export interface ActiveHoursSettings {
  /** The user's edited spans; null while she edits nothing and the card's spans apply. */
  spans: Span[] | null;
}

export type ActiveHoursStorage = PersistedStorage<ActiveHoursSettings>;

export function createActiveHoursSettings(opts?: { storage?: ActiveHoursStorage }) {
  const core = createPersistedStore<ActiveHoursSettings>({
    storage: opts?.storage,
    defaults: { spans: null },
    // The stored JSON is the value shape: the spans field must be null or a valid list.
    parse: (v) => {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
      const spans = (v as { spans?: unknown }).spans;
      if (spans === null) return { spans: null };
      return isValidSpans(spans) ? { spans } : null;
    },
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone: (v) => structuredClone(v),
  });

  return {
    get: core.get,

    setSpans(spans: Span[]): void {
      core.commit({ spans: structuredClone(spans) });
    },

    reset(): void {
      core.commit({ spans: null });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type ActiveHoursSettingsStore = ReturnType<typeof createActiveHoursSettings>;

/** localStorage-based ActiveHoursStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageActiveHoursStorage(key = "yui.active-hours"): ActiveHoursStorage {
  return localStorageStore<ActiveHoursSettings>(key);
}
