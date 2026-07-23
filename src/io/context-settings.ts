import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ContextSettings {
  send_recent_apps: boolean;
  send_active_app: boolean;
  send_window_title: boolean;
  send_posture: boolean;
}

export type ContextSettingsStorage = PersistedStorage<ContextSettings>;

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  send_recent_apps: true,
  send_active_app: true,
  send_window_title: true,
  send_posture: true,
};

function parse(value: unknown): ContextSettings | null {
  if (value === null || typeof value !== "object") return null;
  const settings = value as Record<string, unknown>;
  if (
    typeof settings.send_recent_apps !== "boolean" ||
    typeof settings.send_active_app !== "boolean" ||
    typeof settings.send_window_title !== "boolean" ||
    typeof settings.send_posture !== "boolean"
  ) {
    return null;
  }
  return {
    send_recent_apps: settings.send_recent_apps,
    send_active_app: settings.send_active_app,
    send_window_title: settings.send_window_title,
    send_posture: settings.send_posture,
  };
}

function equals(a: ContextSettings, b: ContextSettings): boolean {
  return (
    a.send_recent_apps === b.send_recent_apps &&
    a.send_active_app === b.send_active_app &&
    a.send_window_title === b.send_window_title &&
    a.send_posture === b.send_posture
  );
}

export function createContextSettings(opts?: {
  storage?: ContextSettingsStorage;
  initial?: ContextSettings;
}) {
  const core = createPersistedStore<ContextSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: DEFAULT_CONTEXT_SETTINGS,
    parse,
    equals,
  });

  return {
    get: core.get,

    set(partial: Partial<ContextSettings>): void {
      const next = { ...core.current() };
      for (const key of Object.keys(DEFAULT_CONTEXT_SETTINGS) as Array<keyof ContextSettings>) {
        if (typeof partial[key] === "boolean") next[key] = partial[key];
      }
      core.commit(next);
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export function localStorageContextSettings(key = "yui.context-settings"): ContextSettingsStorage {
  return localStorageStore<ContextSettings>(key);
}
