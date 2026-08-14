/**
 * Reactive settings store managing which ambient `idle` variants may play.
 *
 * A localStorage overlay over the read-only `configs/motions.json` catalog, keyed by variant
 * file path — the stable identity of a pool member. Stored as the *disabled* set, so variants
 * added to the catalog later are enabled without a migration.
 *
 * `enabledIdleVariants` is the read path: it clamps the pool's baseline (`vrma_path`) back on
 * whatever storage holds, so the missing-clip fallback always has a variant to recover to.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface IdleMotionSettings {
  /** Variant file paths the user turned off. Paths outside the catalog are ignored on read. */
  disabled: string[];
}

/** The catalog side of the overlay — the `idle` entry of configs/motions.json. */
export interface IdleVariantPool {
  /** Baseline variant. Always playable — the user cannot disable it. */
  vrma_path: string;
  variants?: readonly string[];
}

export type IdleMotionStorage = PersistedStorage<IdleMotionSettings>;

function isValidSettings(v: unknown): v is IdleMotionSettings {
  if (v === null || typeof v !== "object") return false;
  const { disabled } = v as Record<string, unknown>;
  return Array.isArray(disabled) && disabled.every((p) => typeof p === "string");
}

/**
 * The variants the idle cycle may pick from, in catalog order. The baseline is always included.
 */
export function enabledIdleVariants(
  pool: IdleVariantPool,
  state: IdleMotionSettings,
): readonly string[] {
  const catalog = pool.variants?.length ? pool.variants : [pool.vrma_path];
  return catalog.filter((path) => path === pool.vrma_path || !state.disabled.includes(path));
}

export function createIdleMotionSettings(opts?: {
  storage?: IdleMotionStorage;
  initial?: IdleMotionSettings;
}) {
  const core = createPersistedStore<IdleMotionSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { disabled: [] },
    parse: (v) => (isValidSettings(v) ? { disabled: [...new Set(v.disabled)] } : null),
    equals: (a, b) =>
      a.disabled.length === b.disabled.length && a.disabled.every((p, i) => p === b.disabled[i]),
    clone: (v) => ({ disabled: [...v.disabled] }),
  });

  return {
    get: core.get,

    setEnabled(path: string, enabled: boolean): void {
      const { disabled } = core.current();
      if (enabled) {
        core.commit({ disabled: disabled.filter((p) => p !== path) });
      } else if (!disabled.includes(path)) {
        core.commit({ disabled: [...disabled, path] });
      }
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type IdleMotionSettingsStore = ReturnType<typeof createIdleMotionSettings>;

/** localStorage-backed IdleMotionStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageIdleMotionStorage(key = "yui.idle_motions"): IdleMotionStorage {
  return localStorageStore<IdleMotionSettings>(key);
}
