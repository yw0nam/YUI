/**
 * Filler phrase and behaviour settings — reactive store.
 * Persists to localStorage(key "yui.filler"), notifies subscribers on change.
 *
 * Priority: stored > initial > defaults (enabled:true, language:"ja", customPools:{})
 */

import type { FillerLang } from "../config/load";
import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface FillerSettings {
  enabled: boolean;
  language: FillerLang;
  customPools: Partial<Record<FillerLang, string[]>>;
}

export type FillerStorage = PersistedStorage<FillerSettings>;

const FILLER_LANGS: readonly FillerLang[] = ["ja", "en", "ko"];

function isValidSettings(v: unknown): v is FillerSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  if (typeof s.language !== "string" || !(FILLER_LANGS as readonly string[]).includes(s.language))
    return false;
  if (s.customPools === null || typeof s.customPools !== "object" || Array.isArray(s.customPools))
    return false;
  return true;
}

const DEFAULTS: FillerSettings = { enabled: true, language: "ja", customPools: {} };

function copySettings(s: FillerSettings): FillerSettings {
  const pools: Partial<Record<FillerLang, string[]>> = {};
  for (const lang of FILLER_LANGS) {
    if (s.customPools[lang] !== undefined) {
      pools[lang] = [...s.customPools[lang]!];
    }
  }
  return { enabled: s.enabled, language: s.language, customPools: pools };
}

function poolsEqual(
  a: Partial<Record<FillerLang, string[]>>,
  b: Partial<Record<FillerLang, string[]>>,
): boolean {
  for (const lang of FILLER_LANGS) {
    const aPool = a[lang];
    const bPool = b[lang];
    if (aPool === undefined && bPool === undefined) continue;
    if (aPool === undefined || bPool === undefined) return false;
    if (aPool.length !== bPool.length) return false;
    for (let i = 0; i < aPool.length; i++) {
      if (aPool[i] !== bPool[i]) return false;
    }
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

    setCustomPool(lang: FillerLang, phrases: string[]): void {
      const current = core.current().customPools[lang];
      // No-op when unchanged — including the unset→empty case (both mean "use config pool").
      if (
        current === undefined
          ? phrases.length === 0
          : current.length === phrases.length && phrases.every((p, i) => current[i] === p)
      )
        return;
      const newPools: Partial<Record<FillerLang, string[]>> = {
        ...core.current().customPools,
        [lang]: [...phrases],
      };
      core.commit({ ...core.current(), customPools: newPools });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage 기반 FillerStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageFillerStorage(key = "yui.filler"): FillerStorage {
  return localStorageStore<FillerSettings>(key);
}
