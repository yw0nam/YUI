/** Device-wide store of the user's last presence; the milestone source is its only writer. */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export interface LastTogetherSettings {
  /** Epoch ms of the last recorded present tick; null until the first one. */
  at: number | null;
}

export type LastTogetherStorage = PersistedStorage<LastTogetherSettings>;

export interface LastTogetherStore {
  get(): LastTogetherSettings;
  /** Record a present tick. */
  setAt(at: number): void;
  /** Write `now` as the last presence. */
  record(now: number): void;
}

export function createLastTogetherSettings(opts?: {
  storage?: LastTogetherStorage;
}): LastTogetherStore {
  const core = createPersistedStore<LastTogetherSettings>({
    storage: opts?.storage ?? localStorageStore<LastTogetherSettings>("yui.last-together"),
    defaults: { at: null },
    parse: (v) =>
      isPlainObject(v) && typeof (v as LastTogetherSettings).at === "number"
        ? { at: (v as LastTogetherSettings).at }
        : null,
    equals: (a, b) => a.at === b.at,
  });
  return {
    get: core.get,
    setAt(at: number): void {
      core.commit({ at });
    },
    record(now: number): void {
      core.commit({ at: now });
    },
  };
}
