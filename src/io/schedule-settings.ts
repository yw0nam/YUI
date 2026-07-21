/**
 * Reactive settings store managing on/off plus the entry list of time-based schedule cues (morning/lunch/evening, etc.).
 * Persists to storage on change and notifies subscribers. Does not stop source subscriptions; only gates firing.
 */

import { createPersistedStore, localStorageStore, type PersistedStorage } from "./persisted-store";

export interface ScheduledCue {
  id: string;
  label: string;
  context: string;
  /** "HH:MM" 24h. */
  time: string;
  enabled: boolean;
}

export interface ScheduleSettings {
  enabled: boolean;
  entries: ScheduledCue[];
}

export type ScheduleStorage = PersistedStorage<ScheduleSettings>;

/** Locale for seeding default cue text. Structurally compatible with ui's Locale — not imported to keep io free of ui. */
export type CueLocale = "en" | "ja" | "ko";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const SEED_ENTRIES: Record<CueLocale, ScheduledCue[]> = {
  ko: [
    {
      id: "morning",
      label: "아침",
      context: "하루를 시작하는 아침 인사. 막 자리에 앉았을 때 가볍게 안부를 물어봐줘.",
      time: "09:00",
      enabled: true,
    },
    {
      id: "lunch",
      label: "점심",
      context: "점심시간이야. 밥은 먹었는지, 오전은 어땠는지 가볍게 물어봐줘.",
      time: "12:00",
      enabled: true,
    },
    {
      id: "evening",
      label: "저녁",
      context: "하루 마무리할 시간이야. 오늘 어땠는지 가볍게 들어봐줘.",
      time: "18:00",
      enabled: true,
    },
    {
      id: "late_night",
      label: "심야",
      context: "많이 늦었어. 이제 좀 쉬는 게 어때? 무리하지 말라고 부드럽게 챙겨줘.",
      time: "23:00",
      enabled: true,
    },
  ],
  en: [
    {
      id: "morning",
      label: "Morning",
      context:
        "A morning greeting to start the day. Lightly ask how they're doing as they settle in.",
      time: "09:00",
      enabled: true,
    },
    {
      id: "lunch",
      label: "Lunch",
      context: "It's lunchtime. Casually ask if they've eaten and how the morning went.",
      time: "12:00",
      enabled: true,
    },
    {
      id: "evening",
      label: "Evening",
      context: "Time to wrap up the day. Lightly ask how today went.",
      time: "18:00",
      enabled: true,
    },
    {
      id: "late_night",
      label: "Late night",
      context:
        "It's really late. Gently suggest getting some rest — tell them not to push too hard.",
      time: "23:00",
      enabled: true,
    },
  ],
  ja: [
    {
      id: "morning",
      label: "朝",
      context: "一日を始める朝のあいさつ。席に着いたばかりの相手に、軽く調子を聞いてあげて。",
      time: "09:00",
      enabled: true,
    },
    {
      id: "lunch",
      label: "昼",
      context: "お昼の時間だよ。ご飯は食べたか、午前中はどうだったか気軽に聞いてみて。",
      time: "12:00",
      enabled: true,
    },
    {
      id: "evening",
      label: "夕方",
      context: "そろそろ一日の締めくくり。今日はどうだったか軽く聞いてあげて。",
      time: "18:00",
      enabled: true,
    },
    {
      id: "late_night",
      label: "深夜",
      context: "もうかなり遅いよ。そろそろ休んだら？無理しないでって、やさしく気遣ってあげて。",
      time: "23:00",
      enabled: true,
    },
  ],
};

export function defaultSettings(locale: CueLocale): ScheduleSettings {
  return { enabled: true, entries: structuredClone(SEED_ENTRIES[locale]) };
}

function isValidCue(v: unknown): v is ScheduledCue {
  if (v === null || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.label === "string" &&
    typeof c.context === "string" &&
    typeof c.time === "string" &&
    TIME_RE.test(c.time) &&
    typeof c.enabled === "boolean"
  );
}

function isValidSettings(v: unknown): v is ScheduleSettings {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.enabled !== "boolean") return false;
  if (!Array.isArray(s.entries)) return false;
  return s.entries.every(isValidCue);
}

export function createScheduleSettings(opts?: {
  storage?: ScheduleStorage;
  initial?: ScheduleSettings;
  locale?: CueLocale;
}) {
  const core = createPersistedStore<ScheduleSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: defaultSettings(opts?.locale ?? "ko"),
    parse: (v) => (isValidSettings(v) ? v : null),
    clone: structuredClone,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  const findCue = (id: string): ScheduledCue | undefined =>
    core.current().entries.find((c) => c.id === id);

  return {
    get: core.get,

    setEnabled(enabled: boolean): void {
      core.commit({ ...core.current(), enabled });
    },

    addCue(): ScheduledCue {
      const cue: ScheduledCue = {
        id: crypto.randomUUID(),
        label: "",
        context: "",
        time: "12:00",
        enabled: true,
      };
      core.commit({ ...core.current(), entries: [...core.current().entries, cue] });
      return { ...cue };
    },

    updateCue(id: string, patch: Partial<Omit<ScheduledCue, "id">>): void {
      const cur = findCue(id);
      if (!cur) return;
      const next: ScheduledCue = { ...cur };
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
      if ("time" in patch && typeof patch.time === "string" && TIME_RE.test(patch.time)) {
        if (next.time !== patch.time) {
          next.time = patch.time;
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

/** localStorage-backed ScheduleStorage adapter. Gracefully ignored where localStorage is unavailable. */
export function localStorageScheduleStorage(key = "yui.schedule"): ScheduleStorage {
  return localStorageStore<ScheduleSettings>(key);
}
