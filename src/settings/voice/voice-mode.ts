/**
 * Voice mode store — how the phone's mic button listens: "tap" toggles on each press, "always"
 * keeps listening while the app is in the foreground. Persisted in localStorage under
 * `yui.voice-mode`.
 */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export type VoiceMode = "tap" | "always";

interface VoiceModeSettings {
  mode: VoiceMode;
}

const STORAGE_KEY = "yui.voice-mode";

export type VoiceModeStore = ReturnType<typeof createVoiceMode>;

export function createVoiceMode(opts?: { storage?: PersistedStorage<VoiceModeSettings> }) {
  const core = createPersistedStore<VoiceModeSettings>({
    storage: opts?.storage ?? localStorageStore<VoiceModeSettings>(STORAGE_KEY),
    defaults: { mode: "tap" },
    parse: (v) => {
      if (!isPlainObject(v)) return null;
      const { mode } = v as { mode?: unknown };
      return mode === "tap" || mode === "always" ? { mode } : null;
    },
    equals: (a, b) => a.mode === b.mode,
  });

  return {
    get: core.get,
    set: (mode: VoiceMode): void => core.commit({ mode }),
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}
