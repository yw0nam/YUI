/**
 * Shared core for the cue-list settings stores (schedule/proactive): an on/off flag plus an
 * editable list of cues. A store supplies its locale-seeded defaults and the one field its cue
 * type adds beyond `Cue` — that field's blank value and validator. Everything else (storage
 * validation, add/update/remove, persist, notify) lives here.
 */

import { createPersistedStore, type PersistedStorage } from "./persisted-store";

/** Locale for seeding default cue text. Structurally compatible with ui's Locale — not imported to keep io free of ui. */
export type CueLocale = "en" | "ja" | "ko";

/** The fields every cue carries. A store's cue type adds the field it fires on. */
export interface Cue {
  id: string;
  label: string;
  context: string;
  enabled: boolean;
}

export interface CueListSettings<C extends Cue> {
  enabled: boolean;
  entries: C[];
}

export type CueStorage<C extends Cue> = PersistedStorage<CueListSettings<C>>;

/** The blank-cue value and validator for each field a cue type adds beyond `Cue`. */
type CueExtras<C extends Cue> = {
  [K in Exclude<keyof C, keyof Cue>]: { blank: C[K]; isValid: (v: unknown) => boolean };
};

interface CueListConfig<C extends Cue> {
  storage?: CueStorage<C>;
  defaults: CueListSettings<C>;
  extras: CueExtras<C>;
}

type FieldRules = Record<string, (v: unknown) => boolean>;

export function createCueListSettings<C extends Cue>(cfg: CueListConfig<C>) {
  const extras = cfg.extras as Record<string, { blank: unknown; isValid: (v: unknown) => boolean }>;

  /** A patch field applies only when it passes its rule; a blank label would erase the cue's name. */
  const rules: FieldRules = {
    label: (v) => typeof v === "string" && v.trim().length > 0,
    context: (v) => typeof v === "string",
    enabled: (v) => typeof v === "boolean",
  };
  for (const [key, extra] of Object.entries(extras)) rules[key] = extra.isValid;

  function isValidCue(v: unknown): v is C {
    if (v === null || typeof v !== "object") return false;
    const c = v as Record<string, unknown>;
    return (
      typeof c.id === "string" &&
      typeof c.label === "string" &&
      typeof c.context === "string" &&
      typeof c.enabled === "boolean" &&
      Object.entries(extras).every(([key, extra]) => extra.isValid(c[key]))
    );
  }

  function isValidSettings(v: unknown): v is CueListSettings<C> {
    if (v === null || typeof v !== "object") return false;
    const s = v as Record<string, unknown>;
    if (typeof s.enabled !== "boolean") return false;
    if (!Array.isArray(s.entries)) return false;
    return s.entries.every(isValidCue);
  }

  const core = createPersistedStore<CueListSettings<C>>({
    storage: cfg.storage,
    defaults: cfg.defaults,
    parse: (v) => (isValidSettings(v) ? v : null),
    clone: structuredClone,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const findCue = (id: string): C | undefined => core.current().entries.find((c) => c.id === id);

  const commitEntries = (entries: C[]): void => core.commit({ ...core.current(), entries });

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    addCue(): C {
      const blanks = Object.fromEntries(Object.entries(extras).map(([k, e]) => [k, e.blank]));
      const cue = {
        id: crypto.randomUUID(),
        label: "",
        context: "",
        enabled: true,
        ...blanks,
      } as C;
      commitEntries([...core.current().entries, cue]);
      return { ...cue };
    },

    updateCue(id: string, patch: Partial<Omit<C, "id">>): void {
      const cur = findCue(id);
      if (!cur) return;
      const next = { ...cur } as Record<string, unknown>;
      let changed = false;

      for (const [key, isValid] of Object.entries(rules)) {
        if (!(key in patch)) continue;
        const v = (patch as Record<string, unknown>)[key];
        if (!isValid(v) || next[key] === v) continue;
        next[key] = v;
        changed = true;
      }

      if (!changed) return;
      commitEntries(core.current().entries.map((c) => (c.id === id ? (next as C) : c)));
    },

    removeCue(id: string): void {
      if (!findCue(id)) return;
      commitEntries(core.current().entries.filter((c) => c.id !== id));
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}
