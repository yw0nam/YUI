/**
 * Reactive store that owns the currently active TTS speaker.
 * The selection is resolved and persisted by SpeakerOption.id (the server-side voice id).
 * It does not talk to the TTS server — it only holds the selection state, persists it,
 * and resolves the active option.
 */

import { TTS_PROVIDERS, ttsProviderOf } from "../../../config/tts-provider";
import type { TtsProviderName } from "../../../contract";
import { isSafeSanitizedId } from "../../assets/safe-id";
import {
  createSelectionStore,
  localStorageOverrideStorage,
  localStorageUserOptionStorage,
  type SelectionOverrideStorage,
  type UserOptionStorage,
} from "../../assets/selection-store";

/** A speaker entry — id/ref_url as returned by the TTS server's voice list or a user import. */
export interface SpeakerOption {
  id: string;
  label?: string;
  ref_url: string;
  source?: "bundled" | "user";
  /** Times this id's clip has been replaced by a same-name re-import — carried by the settings
   *  sync so other windows' filler cache invalidates. Absent for bundled/never-reimported voices. */
  revision?: number;
  /** The TTS provider a user voice belongs to; only the active provider's user voices are listed. */
  provider?: TtsProviderName;
}

/**
 * Next revision for `id`: one past the stored one, 1 for an id the list doesn't carry yet.
 * A same-name re-import replaces the clip behind an unchanged id, and the bump is what
 * carries that through the settings sync into every window's filler cache key.
 */
export function nextRevision(options: SpeakerOption[], id: string): number {
  return (options.find((o) => o.id === id)?.revision ?? 0) + 1;
}

/** The override is the stored id string, or null (no override). */
type SpeakerSelectionStorage = SelectionOverrideStorage;

/** Persistence adapter for the list of imported source:"user" options. */
type UserSpeakerStorage = UserOptionStorage<SpeakerOption>;

/** Synthesizes a single defaultValue speaker as one manifest entry. ref_url may be empty (no clip). */
function synthesizeOption(defaultValue: string): SpeakerOption {
  return { id: defaultValue, label: defaultValue, ref_url: "" };
}

/** Coerces one imported option into a safe source:"user" SpeakerOption (null if incomplete).
 *  ref_url may be empty — a pasted library voice id carries no local clip. A stored voice with no
 *  provider belongs to the default provider. */
function coerceUserSpeaker(v: unknown): SpeakerOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !isSafeSanitizedId(o.id)) return null;
  const refUrl = typeof o.ref_url === "string" ? o.ref_url : "";
  const label = typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
  const revision = typeof o.revision === "number" ? o.revision : undefined;
  const provider = (TTS_PROVIDERS as readonly unknown[]).includes(o.provider)
    ? (o.provider as TtsProviderName)
    : ttsProviderOf({});
  return { id: o.id, label, ref_url: refUrl, source: "user", revision, provider };
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
    ownerKey: "provider",
    // The live provider takes over once the voice list refresh reads the endpoints.
    owner: ttsProviderOf({}),
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
