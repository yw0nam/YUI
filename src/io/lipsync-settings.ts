/**
 * Reactive settings store managing lipsync gain.
 * Persists to storage on change and notifies subscribers.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export const LIPSYNC_GAIN_MIN = 0.5;
export const LIPSYNC_GAIN_MAX = 6.0;
export const LIPSYNC_GAIN_DEFAULT = 2.0;

export interface LipsyncSettings {
  gain: number;
}

export type LipsyncStorage = PersistedStorage<LipsyncSettings>;

function isValidSettings(v: unknown): v is LipsyncSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.gain === "number" && Number.isFinite(s.gain);
}

function clampGain(gain: number): number {
  return Math.min(LIPSYNC_GAIN_MAX, Math.max(LIPSYNC_GAIN_MIN, gain));
}

export function createLipsyncSettings(opts?: {
  storage?: LipsyncStorage;
  initial?: LipsyncSettings;
}) {
  const core = createPersistedStore<LipsyncSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { gain: LIPSYNC_GAIN_DEFAULT },
    parse: (v) => (isValidSettings(v) ? { gain: clampGain(v.gain) } : null),
    equals: (a, b) => a.gain === b.gain,
  });

  return {
    get: core.get,

    setGain(gain: number): void {
      if (!Number.isFinite(gain)) return;
      core.commit({ gain: clampGain(gain) });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed LipsyncStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageLipsyncStorage(key = "yui.lipsync"): LipsyncStorage {
  return localStorageStore<LipsyncSettings>(key);
}
