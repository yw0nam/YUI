/** Device-wide "Your name" store: what `{{user}}` resolves to in every preset's card. */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export interface UserNameSettings {
  name: string;
}

export type UserNameStorage = PersistedStorage<UserNameSettings>;

const MAX_LEN = 64;

const coerceName = (v: unknown): string =>
  typeof v === "string" ? v.trim().slice(0, MAX_LEN) : "";

export function createUserNameSettings(opts?: { storage?: UserNameStorage }) {
  const core = createPersistedStore<UserNameSettings>({
    storage: opts?.storage,
    defaults: { name: "" },
    parse: (v) => (isPlainObject(v) ? { name: coerceName((v as UserNameSettings).name) } : null),
    equals: (a, b) => a.name === b.name,
  });
  return {
    get: core.get,
    setName(s: string): void {
      core.commit({ name: coerceName(s) });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export function localStorageUserNameStorage(key = "yui.user-name"): UserNameStorage {
  return localStorageStore<UserNameSettings>(key);
}
