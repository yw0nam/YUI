/**
 * The preset registry's stored shape and a synchronous read of the active preset. Imports nothing
 * from persisted-store, which reads the active preset through here when it builds an adapter.
 */

import { readBoundPresetId } from "./bound-preset";
import { DEFAULT_PRESET_ID, resolveStorageKey } from "./preset-keys";

/** Device-wide key holding the registry. */
export const PRESETS_KEY = "yui.presets";

export interface PresetEntry {
  id: string;
  name: string;
}

export interface PresetState {
  active: string;
  list: PresetEntry[];
}

export const DEFAULT_PRESET: PresetEntry = { id: DEFAULT_PRESET_ID, name: DEFAULT_PRESET_ID };

/** Sanitizes a stored registry: the default preset is always listed, and an unlisted active id falls back to it. */
export function parsePresetState(v: unknown): PresetState | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const raw = v as { active?: unknown; list?: unknown };
  const list: PresetEntry[] = [];
  for (const item of Array.isArray(raw.list) ? raw.list : []) {
    const { id, name } = (item ?? {}) as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue;
    if (list.some((e) => e.id === id)) continue;
    list.push({ id, name });
  }
  if (!list.some((e) => e.id === DEFAULT_PRESET_ID)) list.unshift({ ...DEFAULT_PRESET });
  const active =
    typeof raw.active === "string" && list.some((e) => e.id === raw.active)
      ? raw.active
      : DEFAULT_PRESET_ID;
  return { active, list };
}

/** The active preset id as storage holds it now; the default preset when nothing valid is stored. */
export function readActivePresetId(): string {
  try {
    const raw = globalThis.localStorage?.getItem(PRESETS_KEY);
    if (!raw) return DEFAULT_PRESET_ID;
    return parsePresetState(JSON.parse(raw))?.active ?? DEFAULT_PRESET_ID;
  } catch {
    return DEFAULT_PRESET_ID;
  }
}

/** The key `key` is stored under for this window's bound or active preset. */
export function resolvePresetKey(key: string): string {
  return resolveStorageKey(key, presetIdForWindow());
}

export function presetIdForWindow(): string {
  return readBoundPresetId() ?? readActivePresetId();
}
