/**
 * Reactive settings store that persists the STT (voice-input) on/off intent.
 * Separate from the listening state (voiceInputStatus), it remembers whether the user
 * quit with voice input left on, so the next run can auto-resume. On change it persists
 * to storage and notifies subscribers.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface SttSettings {
  enabled: boolean;
}

export type SttStorage = PersistedStorage<SttSettings>;

const DEFAULT_SETTINGS: SttSettings = {
  enabled: false,
};

function isValidSettings(v: unknown): v is SttSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean";
}

export function createSttSettings(opts?: { storage?: SttStorage; initial?: SttSettings }) {
  const core = createPersistedStore<SttSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    parse: (v) => (isValidSettings(v) ? { enabled: v.enabled } : null),
    equals: (a, b) => a.enabled === b.enabled,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed SttStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageSttStorage(key = "yui.stt"): SttStorage {
  return localStorageStore<SttSettings>(key);
}
