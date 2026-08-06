/**
 * Reactive store that owns the currently selected VRM.
 * The selection is persisted by AvatarOption.id (stable key) — not by url.
 * It does not perform the renderer swap. It only holds the selection state, persists it, and resolves the active option.
 */

import type { AvatarOption } from "../config/load";
import { isSafeSanitizedId } from "./safe-id";
import {
  createSelectionStore,
  localStorageOverrideStorage,
  localStorageUserOptionStorage,
  type SelectionOverrideStorage,
  type UserOptionStorage,
} from "./selection-store";

/** override is the stored id string, or null (no override). */
export type VrmSelectionStorage = SelectionOverrideStorage;

/** Persistence adapter for the list of imported source:"user" options. */
export type UserVrmStorage = UserOptionStorage<AvatarOption>;

/** Coerce a single imported option into a safe source:"user" AvatarOption (null if incomplete). */
function coerceUserOption(v: unknown): AvatarOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !isSafeSanitizedId(o.id)) return null;
  if (typeof o.url !== "string" || o.url.length === 0) return null;
  const label = typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
  return { id: o.id, label, url: o.url, source: "user" };
}

/** Derive a stable id from the url's filename stem (e.g. "/vrms/carlotta.vrm" → "carlotta"). */
function stemFromUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0];
  const file = path.slice(path.lastIndexOf("/") + 1);
  const stem = file.replace(/\.vrm$/i, "");
  return stem.length > 0 ? stem : "avatar";
}

/** Turn a stem into a display label — capitalize only the first letter (preserve the rest). */
function labelFromStem(stem: string): string {
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** Synthesize a single-model defaultUrl into one manifest entry. */
function synthesizeOption(defaultUrl: string): AvatarOption {
  const id = stemFromUrl(defaultUrl);
  return { id, label: labelFromStem(id), url: defaultUrl, source: "bundled" };
}

export function createVrmSelection(opts: {
  available?: AvatarOption[];
  defaultUrl: string;
  storage?: VrmSelectionStorage;
  userStorage?: UserVrmStorage;
}) {
  return createSelectionStore<AvatarOption>({
    available: opts.available,
    defaultValue: opts.defaultUrl,
    storage: opts.storage,
    userStorage: opts.userStorage,
    synthesize: synthesizeOption,
    coerceUser: coerceUserOption,
    isDefault: (o, url) => o.url === url,
  });
}

/** localStorage-based VrmSelectionStorage adapter; gracefully ignored when localStorage is unavailable. */
export function localStorageVrmStorage(key = "yui.vrm"): VrmSelectionStorage {
  return localStorageOverrideStorage(key);
}

/** localStorage-based UserVrmStorage adapter (imported options list as JSON). Malformed/corrupted entries dropped. */
export function localStorageUserVrmStorage(key = "yui.vrm.user"): UserVrmStorage {
  return localStorageUserOptionStorage(key, coerceUserOption);
}
