import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export const THEMES = ["dawn", "hearth", "system"] as const;
export type Theme = (typeof THEMES)[number];
export interface ThemeSettings {
  theme: Theme;
}
export type ThemeStorage = PersistedStorage<ThemeSettings>;

export function createThemeSettings(opts?: { storage?: ThemeStorage }) {
  const core = createPersistedStore<ThemeSettings>({
    storage: opts?.storage,
    defaults: { theme: "system" },
    parse: (value) => {
      if (!isPlainObject(value)) return null;
      const theme = (value as ThemeSettings).theme;
      return THEMES.includes(theme) ? { theme } : null;
    },
    equals: (a, b) => a.theme === b.theme,
  });
  return {
    get: core.get,
    setTheme(theme: Theme): void {
      core.commit({ theme });
    },
    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export function localStorageThemeStorage(key = "yui.theme"): ThemeStorage {
  return localStorageStore<ThemeSettings>(key);
}
