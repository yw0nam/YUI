/**
 * 시각 기반 schedule cue(아침/점심/저녁 등)의 on/off + 항목 목록을 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다. 소스 구독은 멈추지 않고 firing만 게이팅한다.
 */

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

export interface ScheduleStorage {
  load(): ScheduleSettings | null;
  save(s: ScheduleSettings): void;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_SETTINGS: ScheduleSettings = {
  enabled: true,
  entries: [
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
};

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

function cloneSettings(s: ScheduleSettings): ScheduleSettings {
  return { enabled: s.enabled, entries: s.entries.map((c) => ({ ...c })) };
}

export function createScheduleSettings(opts?: {
  storage?: ScheduleStorage;
  initial?: ScheduleSettings;
}) {
  const storage = opts?.storage;

  let stored: ScheduleSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (isValidSettings(loaded)) stored = loaded;
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: ScheduleSettings = cloneSettings(stored ?? opts?.initial ?? DEFAULT_SETTINGS);

  const subscribers = new Set<(s: ScheduleSettings) => void>();

  function notify(): void {
    const copy = cloneSettings(state);
    for (const cb of subscribers) cb(copy);
  }

  function persist(): void {
    storage?.save(cloneSettings(state));
  }

  function findCue(id: string): ScheduledCue | undefined {
    return state.entries.find((c) => c.id === id);
  }

  return {
    get(): ScheduleSettings {
      return cloneSettings(state);
    },

    setEnabled(enabled: boolean): void {
      if (state.enabled === enabled) return;
      state = { ...state, enabled };
      persist();
      notify();
    },

    addCue(): ScheduledCue {
      const cue: ScheduledCue = {
        id: crypto.randomUUID(),
        label: "",
        context: "",
        time: "12:00",
        enabled: true,
      };
      state = { ...state, entries: [...state.entries, cue] };
      persist();
      notify();
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
      state = { ...state, entries: state.entries.map((c) => (c.id === id ? next : c)) };
      persist();
      notify();
    },

    removeCue(id: string): void {
      if (!findCue(id)) return;
      state = { ...state, entries: state.entries.filter((c) => c.id !== id) };
      persist();
      notify();
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — 값이 실제로 바뀌었을 때만 통지.
    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: ScheduleSettings | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (!isValidSettings(loaded)) return;
      const next = cloneSettings(loaded);
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next;
      notify();
    },

    subscribe(cb: (s: ScheduleSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 ScheduleStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageScheduleStorage(key = "yui.schedule"): ScheduleStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as ScheduleSettings;
      } catch {
        return null;
      }
    },
    save(s) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(s));
      } catch {
        // localStorage 사용 불가 시 no-op
      }
    },
  };
}
