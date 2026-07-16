/**
 * Reactive store that owns the currently active irodori TTS speaker.
 * The selection is resolved and persisted by SpeakerOption.id (the voice-registry key).
 * It does not register with the voice registry — it only holds the selection state,
 * persists it, and resolves the active option.
 */

/** An irodori speaker entry — same shape as EndpointsConfig.irodori_voices[number]. */
export interface SpeakerOption {
  id: string;
  label?: string;
  ref_url: string;
  source?: "bundled" | "user";
}

/** The override is the stored id string, or null (no override). */
export interface SpeakerSelectionStorage {
  load(): string | null;
  save(id: string | null): void;
}

/** Persistence adapter for the list of imported source:"user" options. */
export interface UserSpeakerStorage {
  load(): SpeakerOption[];
  save(list: SpeakerOption[]): void;
}

/** Synthesizes a single defaultId speaker as one manifest entry. ref_url may be empty (no clip). */
function synthesizeOption(defaultId: string): SpeakerOption {
  return { id: defaultId, label: defaultId, ref_url: "" };
}

/** Coerces an override candidate to a safe shape (non-empty string or null). */
function coerceOverride(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
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
  const storage = opts.storage;
  const userStorage = opts.userStorage;

  // The manifest (options + defaultId) is mutable since setManifest can update it.
  // list() is never empty — if available is missing or empty, synthesize a single entry from defaultId.
  function normalize(available: SpeakerOption[] | undefined, fallbackId: string): SpeakerOption[] {
    return available && available.length > 0
      ? available.map((o) => ({ ...o }))
      : [synthesizeOption(fallbackId)];
  }

  let defaultId = opts.defaultId;
  let bundled: SpeakerOption[] = normalize(opts.available, defaultId);

  // Imported user options — entries colliding with a bundled id are dropped (bundled wins).
  function isBundledId(id: string): boolean {
    return bundled.some((o) => o.id === id);
  }
  let userOptions: SpeakerOption[] = [];

  // Union-merges the userStorage list into in-memory userOptions — drops bundled-id collisions
  // and dedupes by id (reloaded entry wins). Ensures entries added by another window aren't lost.
  function mergeUserOptions(): void {
    if (!userStorage) return;
    let persisted: SpeakerOption[];
    try {
      persisted = userStorage.load();
    } catch {
      return; // On storage error, keep the existing user options.
    }
    for (const raw of persisted) {
      const opt = coerceUserSpeaker(raw);
      if (!opt || isBundledId(opt.id)) continue;
      const idx = userOptions.findIndex((u) => u.id === opt.id);
      if (idx >= 0) userOptions[idx] = opt;
      else userOptions.push(opt);
    }
  }
  mergeUserOptions();

  // Full list to resolve against: bundled followed by user (no duplicate ids).
  function options(): SpeakerOption[] {
    return [...bundled, ...userOptions];
  }

  function hasId(id: string): boolean {
    return options().some((o) => o.id === id);
  }

  // Read the stored override, but treat an id no longer in the list (stale/removed) as absent.
  let override: string | null = null;
  if (storage) {
    try {
      const loaded = coerceOverride(storage.load());
      if (loaded !== null) override = loaded;
    } catch {
      // On storage error, fall back to no override.
    }
  }

  // Resolution priority: (1) override (present in list) > (2) defaultId match > (3) list[0].
  function resolve(): SpeakerOption {
    const all = options();
    if (override !== null) {
      const o = all.find((x) => x.id === override);
      if (o) return o;
    }
    return all.find((x) => x.id === defaultId) ?? all[0];
  }

  const subscribers = new Set<(active: SpeakerOption) => void>();

  function notify(): void {
    const copy = { ...resolve() };
    for (const cb of subscribers) cb(copy);
  }

  function persistUser(): void {
    userStorage?.save(userOptions.map((o) => ({ ...o })));
  }

  return {
    list(): SpeakerOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** All bundled ∪ user options (deduped, bundled wins). Same result as list(). */
    getOptions(): SpeakerOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** Adds/updates an imported user option. Rejected if it collides with a bundled id. source is forced to "user". */
    addUserVoice(opt: SpeakerOption): void {
      if (isBundledId(opt.id)) return; // bundled always wins
      const next: SpeakerOption = { ...opt, source: "user" };
      const idx = userOptions.findIndex((o) => o.id === next.id);
      if (idx >= 0) userOptions[idx] = next;
      else userOptions.push(next);
      persistUser();
    },

    /** Removes a user option. If it was the current selection, fall back to default resolution + notify. */
    removeUserVoice(id: string): void {
      const idx = userOptions.findIndex((o) => o.id === id);
      if (idx < 0) return;
      const wasActive = resolve().id === id;
      userOptions.splice(idx, 1);
      persistUser();
      if (!wasActive) return;
      override = null;
      storage?.save(null);
      notify();
    },

    /** Updates a user option's label + persist + (if active) notify. no-op for unknown/bundled id or empty label. */
    renameUserVoice(id: string, label: string): void {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      const opt = userOptions.find((o) => o.id === id);
      if (!opt || opt.label === trimmed) return;
      opt.label = trimmed;
      persistUser();
      if (resolve().id === id) notify();
    },

    getActive(): SpeakerOption {
      return { ...resolve() };
    },

    getActiveId(): string {
      return resolve().id;
    },

    select(id: string): void {
      if (!hasId(id)) return; // unknown id — avoid persisting garbage
      if (resolve().id === id) return; // no-op if already active
      override = id;
      storage?.save(id);
      notify();
    },

    reset(): void {
      if (override === null) return;
      override = null;
      storage?.save(null);
      notify();
    },

    // Config hot-reload: replace manifest + default. Preserve the user override, but fall back to
    // default resolution if it isn't in the new manifest. Notify only when the active id actually changed.
    setManifest(next: { available?: SpeakerOption[]; defaultId: string }): void {
      const before = resolve().id;
      defaultId = next.defaultId;
      bundled = normalize(next.available, defaultId);
      // Drop user options whose id collides with the new bundled set (bundled wins).
      userOptions = userOptions.filter((u) => !isBundledId(u.id));
      if (override !== null && !hasId(override)) override = null;
      if (resolve().id === before) return;
      notify();
    },

    // Reload when another window updated storage — re-read both the user list and the override pointer
    // (prevents cross-window lost updates), and notify only when the resolved result actually changed.
    reloadFromStorage(): void {
      const before = resolve().id;
      mergeUserOptions();
      if (storage) {
        let loaded: string | null;
        try {
          loaded = coerceOverride(storage.load());
        } catch {
          loaded = override;
        }
        override = loaded !== null && hasId(loaded) ? loaded : null;
      }
      if (resolve().id === before) return;
      notify();
    },

    subscribe(cb: (active: SpeakerOption) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage-backed SpeakerSelectionStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageSpeakerStorage(key = "yui.speaker"): SpeakerSelectionStorage {
  return {
    load() {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(id) {
      try {
        if (id === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, id);
      } catch {
        // no-op when localStorage is unavailable
      }
    },
  };
}

/** localStorage-backed UserSpeakerStorage adapter (imported-option list JSON). Incomplete/corrupt entries are dropped. */
export function localStorageUserSpeakerStorage(key = "yui.speaker.user"): UserSpeakerStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((v) => coerceUserSpeaker(v))
          .filter((o): o is SpeakerOption => o !== null);
      } catch {
        return [];
      }
    },
    save(list) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(list));
      } catch {
        // no-op when localStorage is unavailable
      }
    },
  };
}
