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
  /** Write `now` as the last presence, at most once per 60 s. */
  record(now: number): void;
  reloadFromStorage(): void;
  subscribe(cb: (s: LastTogetherSettings) => void): () => void;
  dispose(): void;
}

/** Writes land at most once a minute while the user is present. */
const RECORD_INTERVAL_MS = 60_000;

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
  let lastRecordMs: number | null = null;
  return {
    get: core.get,
    record(now: number): void {
      if (lastRecordMs !== null && now - lastRecordMs < RECORD_INTERVAL_MS) return;
      lastRecordMs = now;
      core.commit({ at: now });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}
