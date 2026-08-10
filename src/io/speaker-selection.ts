/**
 * Reactive store that owns the currently active irodori TTS speaker.
 * The selection is resolved and persisted by SpeakerOption.id (the voice-registry key).
 * It does not register with the voice registry — it only holds the selection state,
 * persists it, and resolves the active option.
 */

import { isSafeSanitizedId } from "./safe-id";
import {
  createSelectionStore,
  localStorageOverrideStorage,
  localStorageUserOptionStorage,
  type SelectionOverrideStorage,
  type UserOptionStorage,
} from "./selection-store";

/** An irodori speaker entry — id/ref_url as returned by the irodori server's voice list or a user import. */
export interface SpeakerOption {
  id: string;
  label?: string;
  ref_url: string;
  source?: "bundled" | "user";
  /** Times this id's clip has been replaced by a same-name re-import — carried by the settings
   *  sync so other windows' filler cache invalidates. Absent for bundled/never-reimported voices. */
  revision?: number;
}

/** The override is the stored id string, or null (no override). */
export type SpeakerSelectionStorage = SelectionOverrideStorage;

/** Persistence adapter for the list of imported source:"user" options. */
export type UserSpeakerStorage = UserOptionStorage<SpeakerOption>;

/** Synthesizes a single defaultValue speaker as one manifest entry. ref_url may be empty (no clip). */
function synthesizeOption(defaultValue: string): SpeakerOption {
  return { id: defaultValue, label: defaultValue, ref_url: "" };
}

/** Coerces one imported option into a safe source:"user" SpeakerOption (null if incomplete). */
function coerceUserSpeaker(v: unknown): SpeakerOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !isSafeSanitizedId(o.id)) return null;
  if (typeof o.ref_url !== "string" || o.ref_url.length === 0) return null;
  const label = typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
  const revision = typeof o.revision === "number" ? o.revision : undefined;
  return { id: o.id, label, ref_url: o.ref_url, source: "user", revision };
}

export function createSpeakerSelection(opts: {
  available?: SpeakerOption[];
  defaultValue: string;
  storage?: SpeakerSelectionStorage;
  userStorage?: UserSpeakerStorage;
}) {
  return createSelectionStore<SpeakerOption>({
    available: opts.available,
    defaultValue: opts.defaultValue,
    storage: opts.storage,
    userStorage: opts.userStorage,
    synthesize: synthesizeOption,
    coerceUser: coerceUserSpeaker,
    isDefault: (o, id) => o.id === id,
  });
}

/** localStorage-backed SpeakerSelectionStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageSpeakerStorage(key = "yui.speaker"): SpeakerSelectionStorage {
  return localStorageOverrideStorage(key);
}

/** localStorage-backed UserSpeakerStorage adapter (imported-option list JSON). Incomplete/corrupt entries are dropped. */
export function localStorageUserSpeakerStorage(key = "yui.speaker.user"): UserSpeakerStorage {
  return localStorageUserOptionStorage(key, coerceUserSpeaker);
}
