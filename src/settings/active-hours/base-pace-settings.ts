/**
 * Base pace settings — reactive store.
 * Persists to localStorage (key "yui.base-pace"), notifies subscribers on change.
 *
 * Priority: stored > defaults ({ pace: "normal" }).
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "../persisted-store";
import type { Pace } from "./spans";

/** The paces a base pace may hold: a span pace without off. */
export type BasePace = Exclude<Pace, "off">;

export interface BasePaceSettings {
  pace: BasePace;
}

export type BasePaceStorage = PersistedStorage<BasePaceSettings>;

export function createBasePaceSettings(opts?: { storage?: BasePaceStorage }) {
  const core = createPersistedStore<BasePaceSettings>({
    storage: opts?.storage,
    defaults: { pace: "normal" },
    parse: (v) =>
      v !== null && typeof v === "object" && !Array.isArray(v) ? (v as BasePaceSettings) : null,
    equals: (a, b) => a.pace === b.pace,
  });

  return {
    get: core.get,

    setPace(pace: BasePace): void {
      core.commit({ pace });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type BasePaceSettingsStore = ReturnType<typeof createBasePaceSettings>;

/** localStorage-based BasePaceStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageBasePaceStorage(key = "yui.base-pace"): BasePaceStorage {
  return localStorageStore<BasePaceSettings>(key);
}
