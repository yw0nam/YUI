/**
 * Reactive store that owns the currently active irodori TTS speaker.
 * The selection is resolved and persisted by SpeakerOption.id (the voice-registry key).
 * It does not register with the voice registry — it only holds the selection state,
 * persists it, and resolves the active option.
 */

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
}

/** The override is the stored id string, or null (no override). */
export type SpeakerSelectionStorage = SelectionOverrideStorage;

/** Persistence adapter for the list of imported source:"user" options. */
export type UserSpeakerStorage = UserOptionStorage<SpeakerOption>;

/** Synthesizes a single defaultId speaker as one manifest entry. ref_url may be empty (no clip). */
function synthesizeOption(defaultId: string): SpeakerOption {
  return { id: defaultId, label: defaultId, ref_url: "" };
}

/** Safe charset for an id (`^[A-Za-z0-9_-]+$`) — matches the native sanitize_stem. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Coerces one imported option into a safe source:"user" SpeakerOption (null if incomplete). */
function coerceUserSpeaker(v: unknown): SpeakerOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !SAFE_ID.test(o.id)) return null;
  if (typeof o.ref_url !== "string" || o.ref_url.length === 0) return null;
  const label = typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
  return { id: o.id, label, ref_url: o.ref_url, source: "user" };
}

export function createSpeakerSelection(opts: {
  available?: SpeakerOption[];
  defaultId: string;
  storage?: SpeakerSelectionStorage;
  userStorage?: UserSpeakerStorage;
}) {
  const store = createSelectionStore<SpeakerOption>({
    available: opts.available,
    defaultValue: opts.defaultId,
    storage: opts.storage,
    userStorage: opts.userStorage,
    synthesize: synthesizeOption,
    coerceUser: coerceUserSpeaker,
    isDefault: (o, id) => o.id === id,
  });

  return {
    list: store.list,

    /** All bundled ∪ user options (deduped, bundled wins). Same result as list(). */
    getOptions: store.getOptions,

    /** Adds/updates an imported user option. Rejected if it collides with a bundled id. source is forced to "user". */
    addUserVoice: store.addUserOption,

    /** Removes a user option. If it was the current selection, fall back to default resolution + notify. */
    removeUserVoice: store.removeUserOption,

    /** Updates a user option's label + persist + (if active) notify. no-op for unknown/bundled id or empty label. */
    renameUserVoice: store.renameUserOption,

    getActive: store.getActive,

    getActiveId: store.getActiveId,

    select: store.select,

    reset: store.reset,

    // Config hot-reload: replace manifest + default. Preserve the user override, but fall back to
    // default resolution if it isn't in the new manifest. Notify only when the active id actually changed.
    setManifest(next: { available?: SpeakerOption[]; defaultId: string }): void {
      store.setManifest({ available: next.available, defaultValue: next.defaultId });
    },

    // Reload when another window updated storage — re-read both the user list and the override pointer
    // (prevents cross-window lost updates), and notify only when the resolved result actually changed.
    reloadFromStorage: store.reloadFromStorage,

    subscribe: store.subscribe,

    dispose: store.dispose,
  };
}

/** localStorage-backed SpeakerSelectionStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageSpeakerStorage(key = "yui.speaker"): SpeakerSelectionStorage {
  return localStorageOverrideStorage(key);
}

/** localStorage-backed UserSpeakerStorage adapter (imported-option list JSON). Incomplete/corrupt entries are dropped. */
export function localStorageUserSpeakerStorage(key = "yui.speaker.user"): UserSpeakerStorage {
  return localStorageUserOptionStorage(key, coerceUserSpeaker);
}
