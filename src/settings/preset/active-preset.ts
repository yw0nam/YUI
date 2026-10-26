/**
 * The preset registry's stored shape and a synchronous read of the active preset. Imports nothing
 * from persisted-store, which reads the active preset through here when it builds an adapter.
 */

import { readBoundPresetId, readEditPresetId } from "./bound-preset";
import { coercePhotoCrop, type PhotoCrop } from "./photo-crop";
import { DEFAULT_PRESET_ID, resolveStorageKey } from "./preset-keys";

/** Device-wide key holding the registry. */
export const PRESETS_KEY = "yui.presets";

export interface PresetEntry {
  id: string;
  name: string;
  /** The file URL of the preset thumbnail; a PNG card import sets it, JSON never does. */
  thumbnail?: string;
  /** The photo's framing; only an entry with a thumbnail keeps one. */
  crop?: PhotoCrop;
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
    const { id, name, thumbnail, crop } = (item ?? {}) as {
      id?: unknown;
      name?: unknown;
      thumbnail?: unknown;
      crop?: unknown;
    };
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue;
    if (list.some((e) => e.id === id)) continue;
    if (typeof thumbnail !== "string" || !thumbnail) {
      list.push({ id, name });
      continue;
    }
    const kept = coercePhotoCrop(crop);
    list.push({ id, name, thumbnail, ...(kept ? { crop: kept } : {}) });
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

/** The stored entry of a preset id; undefined when unlisted. */
export function readPresetEntry(id: string): PresetEntry | undefined {
  return readPresetState()?.list.find((e) => e.id === id);
}

/** The preset a window shows: the bound one when bound, else the active one; an unlisted id is named by itself. */
export function presetEntryFor(state: PresetState, boundId: string | null): PresetEntry {
  const id = boundId ?? state.active;
  return state.list.find((e) => e.id === id) ?? { id, name: id };
}

/** The name a window shows: the bound preset's when bound, else the active preset's. */
export function presetNameFor(state: PresetState, boundId: string | null): string {
  return presetEntryFor(state, boundId).name;
}

/** The key `key` is stored under for this window's edited, bound or active preset. */
export function resolvePresetKey(key: string): string {
  return resolveStorageKey(key, presetIdForWindow());
}

export function presetIdForWindow(): string {
  return readEditPresetId() ?? readBoundPresetId() ?? readActivePresetId();
}
