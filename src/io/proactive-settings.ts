/**
 * Reactive settings store managing on/off plus the entry list of idle-gap-based proactive cues (quick break/gentle check, etc.).
 * Persists to storage on change and notifies subscribers. Does not stop source subscriptions; only gates firing.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ProactiveCue {
  id: string;
  label: string;
  context: string;
  /** Minutes elapsed since the last interaction. */
  idle_min: number;
  enabled: boolean;
}

export interface ProactiveSettings {
  enabled: boolean;
  entries: ProactiveCue[];
}

export type ProactiveStorage = PersistedStorage<ProactiveSettings>;

const DEFAULT_SETTINGS: ProactiveSettings = {
  enabled: true,
  entries: [
    {
      id: "short_break",
      label: "잠깐 환기",
      context: "5분 넘게 조용하네. 잠깐 고개 들고 환기 좀 하라고 살짝 말해줘.",
      idle_min: 5,
      enabled: true,
    },
    {
      id: "mid_check",
      label: "슬슬 체크",
      context: "10분 넘게 말이 없네. 작업 잘 되고 있는지 가볍게 물어봐줘. 부담스럽지 않게.",
      idle_min: 10,
      enabled: true,
    },
    {
      id: "long_focus",
      label: "오래 집중",
      context: "30분이나 됐어. 잠깐 쉬는 건 어때? 너무 오래 앉아 있으면 몸이 힘들잖아.",
      idle_min: 30,
      enabled: true,
    },
  ],
};

function isValidIdleMin(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isValidCue(v: unknown): v is ProactiveCue {
  if (v === null || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.label === "string" &&
    typeof c.context === "string" &&
    isValidIdleMin(c.idle_min) &&
    typeof c.enabled === "boolean"
  );
}

function isValidSettings(v: unknown): v is ProactiveSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  if (!Array.isArray(s.entries)) return false;
  return s.entries.every(isValidCue);
}

/** Legacy { enabled } (no entries) → keep enabled + fill in seed entries. */
function migrate(v: unknown): ProactiveSettings | null {
  if (v === null || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled === "boolean" && !Array.isArray(s.entries)) {
    return { enabled: s.enabled, entries: structuredClone(DEFAULT_SETTINGS.entries) };
  }
  return null;
}

export function createProactiveSettings(opts?: {
  storage?: ProactiveStorage;
  initial?: ProactiveSettings;
}) {
  const core = createPersistedStore<ProactiveSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: DEFAULT_SETTINGS,
    parse: (v) => (isValidSettings(v) ? v : null),
    migrate,
    clone: structuredClone,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const findCue = (id: string): ProactiveCue | undefined =>
    core.current().entries.find((c) => c.id === id);

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    addCue(): ProactiveCue {
      const cue: ProactiveCue = {
        id: crypto.randomUUID(),
        label: "",
        context: "",
        idle_min: 10,
        enabled: true,
      };
      core.commit({ ...core.current(), entries: [...core.current().entries, cue] });
      return { ...cue };
    },

    updateCue(id: string, patch: Partial<Omit<ProactiveCue, "id">>): void {
      const cur = findCue(id);
      if (!cur) return;
      const next: ProactiveCue = { ...cur };
      let changed = false;

      if ("label" in patch && typeof patch.label === "string" && patch.label.trim().length > 0) {
        if (next.label !== patch.label) {
          next.label = patch.label;
          changed = true;
        }
      }
      if ("context" in patch && typeof patch.context === "string") {
        if (next.context !== patch.context) {
          next.context = patch.context;
          changed = true;
        }
      }
      if ("idle_min" in patch && isValidIdleMin(patch.idle_min)) {
        if (next.idle_min !== patch.idle_min) {
          next.idle_min = patch.idle_min;
          changed = true;
        }
      }
      if ("enabled" in patch && typeof patch.enabled === "boolean") {
        if (next.enabled !== patch.enabled) {
          next.enabled = patch.enabled;
          changed = true;
        }
      }

      if (!changed) return;
      core.commit({
        ...core.current(),
        entries: core.current().entries.map((c) => (c.id === id ? next : c)),
      });
    },

    removeCue(id: string): void {
      if (!findCue(id)) return;
      core.commit({
        ...core.current(),
        entries: core.current().entries.filter((c) => c.id !== id),
      });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-backed ProactiveStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageProactiveStorage(key = "yui.proactive"): ProactiveStorage {
  return localStorageStore<ProactiveSettings>(key);
}
