/**
 * Reactive settings store managing whether the first-run onboarding hint has been seen.
 * Persists to storage on change and notifies subscribers.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface HintSettings {
  seen: boolean;
}

export type HintStorage = PersistedStorage<HintSettings>;

const DEFAULT_SETTINGS: HintSettings = {
  seen: false,
};

function isValidSettings(v: unknown): v is HintSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.seen === "boolean";
}

export function createHintSettings(opts?: { storage?: HintStorage; initial?: HintSettings }) {
  const core = createPersistedStore<HintSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { seen: v.seen } : null),
    equals: (a, b) => a.seen === b.seen,
  });

  return {
    get: core.get,

    setSeen(seen: boolean): void {
      core.commit({ ...core.current(), seen });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-based HintStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageHintStorage(key = "yui.hint"): HintStorage {
  return localStorageStore<HintSettings>(key);
}
