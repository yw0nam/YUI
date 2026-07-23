/**
 * Recent-apps buffer cap settings — "keep up to N app switches since the last utterance".
 * Changes persist to storage and notify subscribers reactively.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface RecentAppsSettings {
  recent_apps_max: number;
}

export type RecentAppsStorage = PersistedStorage<RecentAppsSettings>;

export const RECENT_APPS_FLOOR = 1;
export const RECENT_APPS_CEIL = 50;

const DEFAULT_SETTINGS: RecentAppsSettings = { recent_apps_max: 10 };

function isValidRecentAppsMax(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isInteger(v) && v >= RECENT_APPS_FLOOR && v <= RECENT_APPS_CEIL
  );
}

function isValidSettings(v: unknown): v is RecentAppsSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return isValidRecentAppsMax(s.recent_apps_max);
}

export function createRecentAppsSettings(opts?: {
  storage?: RecentAppsStorage;
  initial?: RecentAppsSettings;
}) {
  const core = createPersistedStore<RecentAppsSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { recent_apps_max: v.recent_apps_max } : null),
    equals: (a, b) => a.recent_apps_max === b.recent_apps_max,
  });

  return {
    get: core.get,

    setRecentAppsMax(n: number): void {
      if (!isValidRecentAppsMax(n)) return;
      core.commit({ ...core.current(), recent_apps_max: n });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed RecentAppsStorage adapter. Gracefully no-ops where localStorage is absent. */
export function localStorageRecentAppsStorage(key = "yui.recent-apps"): RecentAppsStorage {
  return localStorageStore<RecentAppsSettings>(key);
}
