/**
 * The preset registry's stored shape and a synchronous read of the active preset. Imports nothing
 * from persisted-store, which reads the active preset through here when it builds an adapter.
 */

import { readBoundPresetId, readEditPresetId } from "./bound-preset";
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

/** The registry as storage holds it now; null when nothing valid is stored. */
function readPresetState(): PresetState | null {
  try {
    const raw = globalThis.localStorage?.getItem(PRESETS_KEY);
    return raw ? parsePresetState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** The registry's presets as storage holds them now, in registry order. */
export function readPresetList(): PresetEntry[] {
  return readPresetState()?.list ?? [{ ...DEFAULT_PRESET }];
}

/** The active preset id as storage holds it now; the default preset when nothing valid is stored. */
export function readActivePresetId(): string {
  return readPresetState()?.active ?? DEFAULT_PRESET_ID;
}

/** The name a stored preset id is listed under; the id itself when unlisted. */
export function readPresetName(id: string): string {
  const state = readPresetState();
  return state ? presetNameFor(state, id) : id;
}

/** The name a window shows: the bound preset's when bound, else the active preset's. */
export function presetNameFor(state: PresetState, boundId: string | null): string {
  const id = boundId ?? state.active;
  return state.list.find((e) => e.id === id)?.name ?? id;
}

/** The key `key` is stored under for this window's edited, bound or active preset. */
export function resolvePresetKey(key: string): string {
  return resolveStorageKey(key, presetIdForWindow());
}

export function presetIdForWindow(): string {
  return readEditPresetId() ?? readBoundPresetId() ?? readActivePresetId();
}
