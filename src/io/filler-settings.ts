/**
 * Filler phrase and behaviour settings — reactive store.
 * Persists to localStorage(key "yui.filler"), notifies subscribers on change.
 *
 * Priority: stored > initial > defaults (enabled:true, language:"ja", customPools:{})
 */

import type { FillerLang } from "../config/load";

export interface FillerSettings {
  enabled: boolean;
  language: FillerLang;
  customPools: Partial<Record<FillerLang, string[]>>;
}

export interface FillerStorage {
  load(): FillerSettings | null;
  save(s: FillerSettings): void;
}

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
  const storage = opts?.storage;

  let stored: FillerSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = copySettings(loaded);
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: FillerSettings = stored
    ? stored
    : opts?.initial
      ? copySettings(opts.initial)
      : copySettings(DEFAULTS);

  const subscribers = new Set<(s: FillerSettings) => void>();

  function notify(): void {
    const copy = copySettings(state);
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): FillerSettings {
      return copySettings(state);
    },

    setEnabled(enabled: boolean): void {
      if (state.enabled === enabled) return;
      state = { ...state, customPools: { ...state.customPools } };
      state.enabled = enabled;
      storage?.save(copySettings(state));
      notify();
    },

    setLanguage(language: FillerLang): void {
      if (state.language === language) return;
      state = { ...state, customPools: { ...state.customPools } };
      state.language = language;
      storage?.save(copySettings(state));
      notify();
    },

    setCustomPool(lang: FillerLang, phrases: string[]): void {
      const current = state.customPools[lang];
      // No-op when unchanged — including the unset→empty case (both mean "use config pool").
      if (
        current === undefined
          ? phrases.length === 0
          : current.length === phrases.length && phrases.every((p, i) => current[i] === p)
      )
        return;
      const newPools: Partial<Record<FillerLang, string[]>> = {
        ...state.customPools,
        [lang]: [...phrases],
      };
      state = { ...state, customPools: newPools };
      storage?.save(copySettings(state));
      notify();
    },

    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: FillerSettings | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (!isValidSettings(loaded)) return;
      const next = copySettings(loaded);
      if (settingsEqual(state, next)) return;
      state = next;
      notify();
    },

    subscribe(cb: (s: FillerSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 FillerStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageFillerStorage(key = "yui.filler"): FillerStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as FillerSettings;
      } catch {
        return null;
      }
    },
    save(s) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(s));
      } catch {
        // localStorage 사용 불가 시 no-op
      }
    },
  };
}
