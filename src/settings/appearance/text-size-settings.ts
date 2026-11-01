import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export const TEXT_SIZES = [0.9, 1, 1.125, 1.25, 1.4] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export interface TextSizeSettings {
  scale: TextSize;
}
export type TextSizeStorage = PersistedStorage<TextSizeSettings>;

export function createTextSizeSettings(opts?: { storage?: TextSizeStorage }) {
  const core = createPersistedStore<TextSizeSettings>({
    storage: opts?.storage,
    defaults: { scale: 1 },
    parse: (value) => {
      if (!isPlainObject(value)) return null;
      const scale = (value as TextSizeSettings).scale;
      return TEXT_SIZES.includes(scale) ? { scale } : null;
    },
    equals: (a, b) => a.scale === b.scale,
  });
  return {
    get: core.get,
    setScale(scale: TextSize): void {
      core.commit({ scale });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export function localStorageTextSizeStorage(key = "yui.text-size"): TextSizeStorage {
  return localStorageStore<TextSizeSettings>(key);
}
