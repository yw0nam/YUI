/**
 * Preset registry — the list of presets and which one is active, under the device-wide key
 * `yui.presets`. Creating a preset copies the active preset's settings keys; removing one deletes
 * every key in its namespace. Switching takes effect when each window reloads (wire-preset).
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "../persisted-store";
import {
  DEFAULT_PRESET,
  PRESETS_KEY,
  type PresetEntry,
  type PresetState,
  parsePresetState,
} from "./active-preset";
import { isPetWindowLive, readOpenPetWindowIds } from "./pet-windows";
import {
  DEFAULT_PRESET_ID,
  PRESET_COPIED_KEYS,
  PRESET_KEYS,
  resolveStorageKey,
} from "./preset-keys";

function randomId(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return n.toString(16).padStart(8, "0");
}

export function createPresetRegistry(deps?: {
  storage?: PersistedStorage<PresetState>;
  newId?: () => string;
}) {
  const newId = deps?.newId ?? randomId;
  const core = createPersistedStore<PresetState>({
    storage: deps?.storage ?? localStorageStore<PresetState>(PRESETS_KEY),
    defaults: { active: DEFAULT_PRESET_ID, list: [{ ...DEFAULT_PRESET }] },
    parse: parsePresetState,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone: (v) => ({ active: v.active, list: v.list.map((e) => ({ ...e })) }),
  });

  // Raw values move between namespaces as stored; each store parses its own on load.
  const kv = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined =>
    globalThis.localStorage;

  // Another window may have committed since this one last read; every edit starts from storage.
  function latest(): PresetState {
    core.reloadFromStorage();
    return core.current();
  }

  function nameFree(name: string, exceptId?: string): boolean {
    return !core.current().list.some((e) => e.id !== exceptId && e.name === name);
  }

  return {
    get: core.get,

    /** Adds a preset seeded with the active preset's settings. Null when the name is empty or taken. */
    create(name: string): string | null {
      const trimmed = name.trim();
      const { active, list } = latest();
      if (!trimmed || !nameFree(trimmed)) return null;
      let id = newId();
      while (id === DEFAULT_PRESET_ID || list.some((e) => e.id === id)) id = randomId();
      try {
        for (const key of PRESET_COPIED_KEYS) {
          const value = kv()?.getItem(resolveStorageKey(key, active));
          if (value !== null && value !== undefined)
            kv()?.setItem(resolveStorageKey(key, id), value);
        }
      } catch {
        // The preset starts from defaults where storage is unavailable
      }
      core.commit({ active, list: [...list, { id, name: trimmed }] });
      return id;
    },

    /** False when the id is unknown or the name is empty or taken. */
    rename(id: string, name: string): boolean {
      const trimmed = name.trim();
      const { active, list } = latest();
      if (!trimmed || !list.some((e) => e.id === id) || !nameFree(trimmed, id)) return false;
      core.commit({
        active,
        list: list.map((e): PresetEntry => (e.id === id ? { id, name: trimmed } : e)),
      });
      return true;
    },

    /** Deletes a preset and its keys. The default preset and the active one are kept. */
    remove(id: string): boolean {
      const { active, list } = latest();
      if (
        id === DEFAULT_PRESET_ID ||
        id === active ||
        !list.some((e) => e.id === id) ||
        readOpenPetWindowIds().includes(id) ||
        isPetWindowLive(id)
      )
        return false;
      try {
        for (const key of PRESET_KEYS) kv()?.removeItem(resolveStorageKey(key, id));
      } catch {
        // Keys stay behind where storage is unavailable; the preset still leaves the list
      }
      core.commit({ active, list: list.filter((e) => e.id !== id) });
      return true;
    },

    /** Makes a listed preset the active one. */
    activate(id: string): boolean {
      const { list } = latest();
      if (
        !list.some((e) => e.id === id) ||
        readOpenPetWindowIds().includes(id) ||
        isPetWindowLive(id)
      )
        return false;
      core.commit({ active: id, list });
      return true;
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

export type PresetRegistry = ReturnType<typeof createPresetRegistry>;
