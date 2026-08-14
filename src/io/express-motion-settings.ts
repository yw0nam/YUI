/**
 * Reactive settings store curating the motion vocabulary the agent may choose from.
 *
 * A localStorage overlay over the read-only `configs/motions.json` catalog, keyed by motion id.
 * Stored as the *disabled* set, so motions added to the catalog later are selectable without a
 * migration.
 *
 * `enabledExpressMotions` is the read path, applied where the broker payload is derived so the
 * broker publish and the Chat-Completions tool schema follow the same list. All-off is a valid
 * selection: the cue then carries expression and voice tone only.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ExpressMotionSettings {
  /** Motion ids the user turned off. Ids outside the vocabulary are ignored on read. */
  disabled: string[];
}

export type ExpressMotionStorage = PersistedStorage<ExpressMotionSettings>;

function isValidSettings(v: unknown): v is ExpressMotionSettings {
  if (v === null || typeof v !== "object") return false;
  const { disabled } = v as Record<string, unknown>;
  return Array.isArray(disabled) && disabled.every((id) => typeof id === "string");
}

/** The vocabulary the agent may select from, in catalog order. */
export function enabledExpressMotions(
  vocabulary: readonly string[],
  state: ExpressMotionSettings,
): string[] {
  return vocabulary.filter((id) => !state.disabled.includes(id));
}

export function createExpressMotionSettings(opts?: {
  storage?: ExpressMotionStorage;
  initial?: ExpressMotionSettings;
}) {
  const core = createPersistedStore<ExpressMotionSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { disabled: [] },
    parse: (v) => (isValidSettings(v) ? { disabled: [...new Set(v.disabled)] } : null),
    equals: (a, b) =>
      a.disabled.length === b.disabled.length && a.disabled.every((id, i) => id === b.disabled[i]),
    clone: (v) => ({ disabled: [...v.disabled] }),
  });

  /** One commit for any number of ids, so a group toggle notifies (and re-publishes) once. */
  function setAllEnabled(ids: readonly string[], enabled: boolean): void {
    const { disabled } = core.current();
    if (enabled) {
      core.commit({ disabled: disabled.filter((id) => !ids.includes(id)) });
    } else {
      const added = ids.filter((id) => !disabled.includes(id));
      core.commit({ disabled: [...disabled, ...added] });
    }
  }

  return {
    get: core.get,

    setEnabled(id: string, enabled: boolean): void {
      setAllEnabled([id], enabled);
    },

    setAllEnabled,

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type ExpressMotionSettingsStore = ReturnType<typeof createExpressMotionSettings>;

/** localStorage-backed ExpressMotionStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageExpressMotionStorage(
  key = "yui.express_motions",
): ExpressMotionStorage {
  return localStorageStore<ExpressMotionSettings>(key);
}
