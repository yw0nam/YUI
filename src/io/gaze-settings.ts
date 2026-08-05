/**
 * Reactive settings store managing cursor gaze tracking on/off.
 * Persists to storage on change and notifies subscribers.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface GazeSettings {
  enabled: boolean;
}

export type GazeStorage = PersistedStorage<GazeSettings>;

const DEFAULT_SETTINGS: GazeSettings = {
  enabled: true,
};

function isValidSettings(v: unknown): v is GazeSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createGazeSettings(opts?: { storage?: GazeStorage; initial?: GazeSettings }) {
  const core = createPersistedStore<GazeSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { enabled: v.enabled } : null),
    equals: (a, b) => a.enabled === b.enabled,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-based GazeStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageGazeStorage(key = "yui.gaze"): GazeStorage {
  return localStorageStore<GazeSettings>(key);
}
