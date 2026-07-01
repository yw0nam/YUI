/**
 * Presence window settings — "present when idle ≤ N ms".
 * Changes persist to storage and notify subscribers reactively.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface PresenceSettings {
  present_max_idle_ms: number;
}

export type PresenceStorage = PersistedStorage<PresenceSettings>;

export const PRESENCE_FLOOR_MS = 10000;

const DEFAULT_SETTINGS: PresenceSettings = { present_max_idle_ms: 180000 };

function isValidPresentMaxIdleMs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= PRESENCE_FLOOR_MS;
}

function isValidSettings(v: unknown): v is PresenceSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return isValidPresentMaxIdleMs(s.present_max_idle_ms);
}

export function createPresenceSettings(opts?: {
  storage?: PresenceStorage;
  initial?: PresenceSettings;
}) {
  const core = createPersistedStore<PresenceSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { present_max_idle_ms: v.present_max_idle_ms } : null),
    equals: (a, b) => a.present_max_idle_ms === b.present_max_idle_ms,
  });

  return {
    get: core.get,

    setPresentMaxIdleMs(ms: number): void {
      if (!isValidPresentMaxIdleMs(ms)) return;
      core.commit({ ...core.current(), present_max_idle_ms: ms });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed PresenceStorage adapter. Gracefully no-ops where localStorage is absent. */
export function localStoragePresenceStorage(key = "yui.presence"): PresenceStorage {
  return localStorageStore<PresenceSettings>(key);
}
