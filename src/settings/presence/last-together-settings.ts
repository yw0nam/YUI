/** Device-wide store of the user's last presence; the milestone source is its only writer. */

import { localStorageStore, type PersistedStorage } from "../persisted-store";

export interface LastTogetherSettings {
  /** Epoch ms of the last recorded present tick; null until the first one. */
  at: number | null;
}

export type LastTogetherStorage = PersistedStorage<LastTogetherSettings>;

export interface LastTogetherStore {
  get(): LastTogetherSettings;
  /** Record a present tick. */
  setAt(at: number): void;
}

export function createLastTogetherSettings(opts?: {
  storage?: LastTogetherStorage;
}): LastTogetherStore {
  const storage = opts?.storage ?? localStorageStore<LastTogetherSettings>("yui.last-together");
  let state: LastTogetherSettings = storage.load() ?? { at: null };
  return {
    get: () => ({ ...state }),
    setAt(at: number): void {
      state = { at };
      storage.save(state);
    },
  };
}
