/** Device-wide reading dictionary: the raw `surface=reading` text, so ignored lines stay as typed. */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export interface ReadingsSettings {
  text: string;
}

export type ReadingsStorage = PersistedStorage<ReadingsSettings>;

export function createReadingsSettings(opts?: { storage?: ReadingsStorage }) {
  const core = createPersistedStore<ReadingsSettings>({
    storage: opts?.storage,
    defaults: { text: "" },
    parse: (v) =>
      isPlainObject(v) && typeof (v as ReadingsSettings).text === "string"
        ? { text: (v as ReadingsSettings).text }
        : null,
    equals: (a, b) => a.text === b.text,
  });
  return {
    get: core.get,
    setText(text: string): void {
      core.commit({ text });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export function localStorageReadingsStorage(key = "yui.tts-readings"): ReadingsStorage {
  return localStorageStore<ReadingsSettings>(key);
}
