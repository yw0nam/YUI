/**
 * Reactive settings store managing idle power-saving (30fps cap) on/off.
 * Persists to storage on change and notifies subscribers.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface IdleThrottleSettings {
  enabled: boolean;
}

export type IdleThrottleStorage = PersistedStorage<IdleThrottleSettings>;

const DEFAULT_SETTINGS: IdleThrottleSettings = {
  enabled: true,
};

function isValidSettings(v: unknown): v is IdleThrottleSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createIdleThrottleSettings(opts?: {
  storage?: IdleThrottleStorage;
  initial?: IdleThrottleSettings;
}) {
  const core = createPersistedStore<IdleThrottleSettings>({
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

/** localStorage-backed IdleThrottleStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageIdleThrottleStorage(key = "yui.idle-throttle"): IdleThrottleStorage {
  return localStorageStore<IdleThrottleSettings>(key);
}
