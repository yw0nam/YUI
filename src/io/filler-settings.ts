/**
 * Filler phrase and behaviour settings — reactive store.
 * Persists to localStorage(key "yui.filler"), notifies subscribers on change.
 *
 * Priority: stored > initial > defaults (enabled:true, language:"ja", customPools:{})
 */

import type { FillerLang, FillerPool } from "../config/load";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface FillerSettings {
  enabled: boolean;
  language: FillerLang;
  customPools: Partial<Record<FillerLang, FillerPool>>;
}

export type FillerStorage = PersistedStorage<FillerSettings>;

const FILLER_LANGS: readonly FillerLang[] = ["ja", "en", "ko"];

function isValidPool(p: unknown): p is FillerPool {
  if (p === null || typeof p !== "object" || Array.isArray(p)) return false;
  const o = p as Record<string, unknown>;
  if (!Array.isArray(o.first) || o.first.some((x) => typeof x !== "string")) return false;
  if (!Array.isArray(o.repeat) || o.repeat.some((x) => typeof x !== "string")) return false;
  return true;
}

function isValidSettings(v: unknown): v is FillerSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  if (typeof s.language !== "string" || !(FILLER_LANGS as readonly string[]).includes(s.language))
    return false;
  if (s.customPools === null || typeof s.customPools !== "object" || Array.isArray(s.customPools))
    return false;
  // Each present entry must be {first: string[]; repeat: string[]}, not the old string[] shape.
  const pools = s.customPools as Record<string, unknown>;
  for (const lang of FILLER_LANGS) {
    if (pools[lang] !== undefined && !isValidPool(pools[lang])) return false;
  }
  return true;
}

const DEFAULTS: FillerSettings = { enabled: true, language: "ja", customPools: {} };

function copyPool(p: FillerPool): FillerPool {
  return { first: [...p.first], repeat: [...p.repeat] };
}

function copySettings(s: FillerSettings): FillerSettings {
  const pools: Partial<Record<FillerLang, FillerPool>> = {};
  for (const lang of FILLER_LANGS) {
    if (s.customPools[lang] !== undefined) {
      pools[lang] = copyPool(s.customPools[lang]!);
    }
  }
  return { enabled: s.enabled, language: s.language, customPools: pools };
}

function tierEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function poolsEqual(
  a: Partial<Record<FillerLang, FillerPool>>,
  b: Partial<Record<FillerLang, FillerPool>>,
): boolean {
  for (const lang of FILLER_LANGS) {
    const aPool = a[lang];
    const bPool = b[lang];
    if (aPool === undefined && bPool === undefined) continue;
    if (aPool === undefined || bPool === undefined) return false;
    if (!tierEqual(aPool.first, bPool.first) || !tierEqual(aPool.repeat, bPool.repeat))
      return false;
  }
  return true;
}

function settingsEqual(a: FillerSettings, b: FillerSettings): boolean {
  return (
    a.enabled === b.enabled && a.language === b.language && poolsEqual(a.customPools, b.customPools)
  );
}

export function createFillerSettings(opts?: { storage?: FillerStorage; initial?: FillerSettings }) {
  const core = createPersistedStore<FillerSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: DEFAULTS,
    parse: (v) => (isValidSettings(v) ? copySettings(v) : null),
    clone: copySettings,
    equals: settingsEqual,
  });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    setLanguage(language: FillerLang): void {
      core.commit({ ...core.current(), language });
    },

    setCustomPool(lang: FillerLang, p: FillerPool): void {
      const current = core.current().customPools[lang];
      // No-op when unchanged — including unset→both-empty (both mean "use config pool").
      const bothEmpty = p.first.length === 0 && p.repeat.length === 0;
      if (
        current === undefined
          ? bothEmpty
          : tierEqual(current.first, p.first) && tierEqual(current.repeat, p.repeat)
      )
        return;
      const newPools: Partial<Record<FillerLang, FillerPool>> = {
        ...core.current().customPools,
        [lang]: copyPool(p),
      };
      core.commit({ ...core.current(), customPools: newPools });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-based FillerStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageFillerStorage(key = "yui.filler"): FillerStorage {
  return localStorageStore<FillerSettings>(key);
}
