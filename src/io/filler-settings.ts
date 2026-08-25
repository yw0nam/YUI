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
  /** Any tier may be absent — an absent tier means "use the config pool" (old stored data stays valid). */
  customPools: Partial<Record<FillerLang, Partial<FillerPool>>>;
}

export type FillerStorage = PersistedStorage<FillerSettings>;

const FILLER_LANGS: readonly FillerLang[] = ["ja", "en", "ko"];
const LIST_TIERS = ["first", "repeat", "long_wait", "timeout", "unreachable"] as const;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isToolDict(v: unknown): v is Record<string, string[]> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(isStringArray);
}

function isValidPool(p: unknown): p is Partial<FillerPool> {
  if (p === null || typeof p !== "object" || Array.isArray(p)) return false;
  const o = p as Record<string, unknown>;
  for (const tier of LIST_TIERS) {
    if (o[tier] !== undefined && !isStringArray(o[tier])) return false;
  }
  if (o.tool !== undefined && !isToolDict(o.tool)) return false;
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

// Copies only the tiers actually present — an absent tier stays absent (means "use config pool").
function copyPool(p: Partial<FillerPool>): Partial<FillerPool> {
  const out: Partial<FillerPool> = {};
  for (const tier of LIST_TIERS) {
    if (p[tier] !== undefined) out[tier] = [...p[tier]];
  }
  if (p.tool !== undefined) {
    out.tool = Object.fromEntries(Object.entries(p.tool).map(([k, v]) => [k, [...v]]));
  }
  return out;
}

function copySettings(s: FillerSettings): FillerSettings {
  const pools: Partial<Record<FillerLang, Partial<FillerPool>>> = {};
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

// Absent tier == empty tier (both mean "use the config pool").
function listTierEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  return tierEqual(a ?? [], b ?? []);
}

function toolDictEqual(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined,
): boolean {
  const av = a ?? {};
  const bv = b ?? {};
  const aKeys = Object.keys(av);
  if (aKeys.length !== Object.keys(bv).length) return false;
  return aKeys.every((k) => bv[k] !== undefined && tierEqual(av[k]!, bv[k]!));
}

function poolEqual(a: Partial<FillerPool>, b: Partial<FillerPool>): boolean {
  return (
    LIST_TIERS.every((tier) => listTierEqual(a[tier], b[tier])) && toolDictEqual(a.tool, b.tool)
  );
}

function isEmptyPool(p: Partial<FillerPool>): boolean {
  return poolEqual(p, {});
}

function poolsEqual(
  a: Partial<Record<FillerLang, Partial<FillerPool>>>,
  b: Partial<Record<FillerLang, Partial<FillerPool>>>,
): boolean {
  for (const lang of FILLER_LANGS) {
    const aPool = a[lang];
    const bPool = b[lang];
    if (aPool === undefined && bPool === undefined) continue;
    if (!poolEqual(aPool ?? {}, bPool ?? {})) return false;
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

    setCustomPool(lang: FillerLang, p: Partial<FillerPool>): void {
      const current = core.current().customPools[lang];
      // No-op when unchanged — including unset→all-empty (both mean "use config pool").
      if (current === undefined ? isEmptyPool(p) : poolEqual(current, p)) return;
      const newPools: Partial<Record<FillerLang, Partial<FillerPool>>> = {
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
