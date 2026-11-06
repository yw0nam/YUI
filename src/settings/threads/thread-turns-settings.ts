/** thread-turns-settings — which Thread updates give the main character a signals turn. Device-wide. */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export const THREAD_TURNS = ["off", "notable", "every"] as const;
export type ThreadTurnsLevel = (typeof THREAD_TURNS)[number];
export interface ThreadTurnsSettings {
  level: ThreadTurnsLevel;
}
export type ThreadTurnsStorage = PersistedStorage<ThreadTurnsSettings>;

export function createThreadTurnsSettings(opts?: { storage?: ThreadTurnsStorage }) {
  const core = createPersistedStore<ThreadTurnsSettings>({
    storage: opts?.storage,
    defaults: { level: "off" },
    parse: (value) => {
      if (!isPlainObject(value)) return null;
      const level = (value as ThreadTurnsSettings).level;
      return THREAD_TURNS.includes(level) ? { level } : null;
    },
    equals: (a, b) => a.level === b.level,
  });
  return {
    get: core.get,
    setLevel(level: ThreadTurnsLevel): void {
      core.commit({ level });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type ThreadTurnsSettingsStore = ReturnType<typeof createThreadTurnsSettings>;

export function localStorageThreadTurnsStorage(key = "yui.thread-turns"): ThreadTurnsStorage {
  return localStorageStore<ThreadTurnsSettings>(key);
}
