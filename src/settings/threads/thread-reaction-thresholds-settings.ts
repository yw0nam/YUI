/** thread-reaction-thresholds-settings — the waiting count and wait at which a Thread reaction starts without a chip tap. Device-wide. */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

/** Waiting-Threads count options; `0` is Off. */
export const REACTION_COUNTS = [0, 2, 3, 5] as const;
export type ReactionCount = (typeof REACTION_COUNTS)[number];
/** Wait options in minutes; `0` is Off. */
export const REACTION_WAITS = [0, 5, 10, 30] as const;
export type ReactionWait = (typeof REACTION_WAITS)[number];

export interface ThreadReactionThresholdsSettings {
  count: ReactionCount;
  wait_min: ReactionWait;
}
export type ThreadReactionThresholdsStorage = PersistedStorage<ThreadReactionThresholdsSettings>;

const DEFAULTS: ThreadReactionThresholdsSettings = { count: 3, wait_min: 10 };

export function createThreadReactionThresholdsSettings(opts?: {
  storage?: ThreadReactionThresholdsStorage;
}) {
  const core = createPersistedStore<ThreadReactionThresholdsSettings>({
    storage: opts?.storage,
    defaults: DEFAULTS,
    parse: (value) => {
      if (!isPlainObject(value)) return null;
      const raw = value as ThreadReactionThresholdsSettings;
      return {
        count: REACTION_COUNTS.includes(raw.count) ? raw.count : DEFAULTS.count,
        wait_min: REACTION_WAITS.includes(raw.wait_min) ? raw.wait_min : DEFAULTS.wait_min,
      };
    },
    equals: (a, b) => a.count === b.count && a.wait_min === b.wait_min,
  });
  return {
    get: core.get,
    setCount(count: ReactionCount): void {
      core.commit({ ...core.current(), count });
    },
    setWait(wait_min: ReactionWait): void {
      core.commit({ ...core.current(), wait_min });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type ThreadReactionThresholdsSettingsStore = ReturnType<
  typeof createThreadReactionThresholdsSettings
>;

export function localStorageThreadReactionThresholdsStorage(
  key = "yui.thread-reaction-thresholds",
): ThreadReactionThresholdsStorage {
  return localStorageStore<ThreadReactionThresholdsSettings>(key);
}
