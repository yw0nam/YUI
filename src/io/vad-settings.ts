/**
 * Reactive settings store managing the VAD silence window.
 * On change, persists to storage and notifies subscribers.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export const VAD_SILENCE_MIN = 500;
export const VAD_SILENCE_MAX = 3000;
export const VAD_SILENCE_DEFAULT = 1500;

export interface VadSettings {
  silenceMs: number;
  bargeIn: boolean;
}

export type VadStorage = PersistedStorage<VadSettings>;

function isValidSettings(v: unknown): v is VadSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.silenceMs !== "number" || !Number.isFinite(s.silenceMs)) return false;
  // bargeIn may be absent on old stored values — only validate its type when present.
  return s.bargeIn === undefined || typeof s.bargeIn === "boolean";
}

function clampSilence(ms: number): number {
  return Math.min(VAD_SILENCE_MAX, Math.max(VAD_SILENCE_MIN, ms));
}

export function createVadSettings(opts?: { storage?: VadStorage; initial?: VadSettings }) {
  const core = createPersistedStore<VadSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { silenceMs: VAD_SILENCE_DEFAULT, bargeIn: true },
    parse: (v) =>
      isValidSettings(v)
        ? {
            silenceMs: clampSilence(v.silenceMs),
            bargeIn: typeof v.bargeIn === "boolean" ? v.bargeIn : true,
          }
        : null,
    equals: (a, b) => a.silenceMs === b.silenceMs && a.bargeIn === b.bargeIn,
  });

  return {
    get: core.get,

    setSilenceMs(ms: number): void {
      if (!Number.isFinite(ms)) return;
      core.commit({ ...core.get(), silenceMs: clampSilence(ms) });
    },

    setBargeIn(on: boolean): void {
      core.commit({ ...core.get(), bargeIn: on });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed VadStorage adapter. Gracefully no-ops in environments without localStorage. */
export function localStorageVadStorage(key = "yui.vad"): VadStorage {
  return localStorageStore<VadSettings>(key);
}
