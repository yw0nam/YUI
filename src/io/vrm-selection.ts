/**
 * Reactive store that owns the currently selected VRM.
 * The selection is persisted by AvatarOption.id (stable key) — not by url.
 * It does not perform the renderer swap. It only holds the selection state, persists it, and resolves the active option.
 */

import type { AvatarOption } from "../config/load";

/** override is the stored id string, or null (no override). */
export interface VrmSelectionStorage {
  load(): string | null;
  save(id: string | null): void;
}

/** Persistence adapter for the list of imported source:"user" options. */
export interface UserVrmStorage {
  load(): AvatarOption[];
  save(list: AvatarOption[]): void;
}

/** Safe charset for an id (`^[A-Za-z0-9_-]+$`) — matches the native sanitize_stem. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Coerce a single imported option into a safe source:"user" AvatarOption (null if incomplete). */
function coerceUserOption(v: unknown): AvatarOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !SAFE_ID.test(o.id)) return null;
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

/** Coerce an override candidate into a safe shape (non-empty string or null). */
function coerceOverride(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function createVrmSelection(opts: {
  available?: AvatarOption[];
  defaultUrl: string;
  storage?: VrmSelectionStorage;
  userStorage?: UserVrmStorage;
}) {
  const storage = opts.storage;
  const userStorage = opts.userStorage;

  // The manifest (options + defaultUrl) is mutable since setManifest can update it.
  // list() is never empty — when available is missing or empty, synthesize a single entry from defaultUrl.
  function normalize(available: AvatarOption[] | undefined, fallbackUrl: string): AvatarOption[] {
    return available && available.length > 0
      ? available.map((o) => ({ ...o }))
      : [synthesizeOption(fallbackUrl)];
  }

  let defaultUrl = opts.defaultUrl;
  let bundled: AvatarOption[] = normalize(opts.available, defaultUrl);

  // Imported user options — discard entries colliding with bundled ids (bundled wins).
  function isBundledId(id: string): boolean {
    return bundled.some((o) => o.id === id);
  }
  let userOptions: AvatarOption[] = [];

  // Union-merge userStorage list into in-memory userOptions — discard bundled id collisions,
  // dedupe by id (reloaded entries win). Prevents lost updates from other windows.
  function mergeUserOptions(): void {
    if (!userStorage) return;
    let persisted: AvatarOption[];
    try {
      persisted = userStorage.load();
    } catch {
      return; // Preserve existing user options on storage error
    }
    for (const raw of persisted) {
      const opt = coerceUserOption(raw);
      if (!opt || isBundledId(opt.id)) continue;
      const idx = userOptions.findIndex((u) => u.id === opt.id);
      if (idx >= 0) userOptions[idx] = opt;
      else userOptions.push(opt);
    }
  }
  mergeUserOptions();

  // Full list of candidates to resolve: user entries after bundled (no duplicate ids).
  function options(): AvatarOption[] {
    return [...bundled, ...userOptions];
  }

  function hasId(id: string): boolean {
    return options().some((o) => o.id === id);
  }

  // Load stored override, treat stale/removed ids as absent.
  let override: string | null = null;
  if (storage) {
    try {
      const loaded = coerceOverride(storage.load());
      if (loaded !== null && hasId(loaded)) override = loaded;
    } catch {
      // Fall back to no override on storage error
    }
  }

  // Resolution priority: (1) override (present in list) > (2) defaultUrl match > (3) list[0].
  function resolve(): AvatarOption {
    const all = options();
    if (override !== null) {
      const o = all.find((x) => x.id === override);
      if (o) return o;
    }
    return all.find((x) => x.url === defaultUrl) ?? all[0];
  }

  const subscribers = new Set<(active: AvatarOption) => void>();

  function notify(): void {
    const copy = { ...resolve() };
    for (const cb of subscribers) cb(copy);
  }

  function persistUser(): void {
    userStorage?.save(userOptions.map((o) => ({ ...o })));
  }

  return {
    list(): AvatarOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** All options bundled ∪ user (dedup, bundled wins). Same result as list(). */
    getOptions(): AvatarOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** Add/update imported user option. Reject bundled id collisions; force source to "user". */
    addUserOption(opt: AvatarOption): void {
      if (isBundledId(opt.id)) return; // bundled always wins
      const next: AvatarOption = { ...opt, source: "user" };
      const idx = userOptions.findIndex((o) => o.id === next.id);
      if (idx >= 0) userOptions[idx] = next;
      else userOptions.push(next);
      persistUser();
    },

    /** Remove user option. If currently selected, fall back to default resolution + notify. */
    removeUserOption(id: string): void {
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

    /** Update user option label + persist + notify (if active). Unknown/bundled id or empty label is no-op. */
    renameUserOption(id: string, label: string): void {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      const opt = userOptions.find((o) => o.id === id);
      if (!opt || opt.label === trimmed) return;
      opt.label = trimmed;
      persistUser();
      if (resolve().id === id) notify();
    },

    getActive(): AvatarOption {
      return { ...resolve() };
    },

    getActiveId(): string {
      return resolve().id;
    },

    select(id: string): void {
      if (!hasId(id)) return; // Unknown id — prevent garbage persist
      if (resolve().id === id) return; // No-op if already active
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

    // Config hot-reload: replace manifest + default. Preserve user override, but
    // fall back to default resolution if absent in new manifest. Notify only if active id actually changes.
    setManifest(next: { available?: AvatarOption[]; defaultUrl: string }): void {
      const before = resolve().id;
      defaultUrl = next.defaultUrl;
      bundled = normalize(next.available, defaultUrl);
      // Drop user options colliding with new bundled ids (bundled wins).
      userOptions = userOptions.filter((u) => !isBundledId(u.id));
      if (override !== null && !hasId(override)) override = null;
      if (resolve().id === before) return;
      notify();
    },

    // Reload when other window updates storage — re-read both user list and override pointer to
    // prevent cross-window lost update; notify only if resolution actually changed.
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

    subscribe(cb: (active: AvatarOption) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage-based VrmSelectionStorage adapter; gracefully ignored when localStorage is unavailable. */
export function localStorageVrmStorage(key = "yui.vrm"): VrmSelectionStorage {
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
        // No-op when localStorage is unavailable
      }
    },
  };
}

/** localStorage-based UserVrmStorage adapter (imported options list as JSON). Malformed/corrupted entries dropped. */
export function localStorageUserVrmStorage(key = "yui.vrm.user"): UserVrmStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((v) => coerceUserOption(v)).filter((o): o is AvatarOption => o !== null);
      } catch {
        return [];
      }
    },
    save(list) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(list));
      } catch {
        // No-op when localStorage is unavailable
      }
    },
  };
}
