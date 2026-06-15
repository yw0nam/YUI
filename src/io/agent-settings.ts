/**
 * AI 에이전트 요청 정형화(reasoning effort + system instructions override)를 관리하는 reactive 설정 스토어.
 * 변경 시 storage에 persist하고 구독자에게 통지한다.
 */

export type ReasoningEffort = "none" | "minimal" | "low" | "medium";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium"];
export const INSTRUCTIONS_MAX_LEN = 4000;

export interface AgentSettings {
  reasoning_effort: ReasoningEffort; // 백엔드로 보내는 reasoning.effort 값 ("none" => 추론 안 함)
  instructions: string; // "" => 호출자가 config.chat_instructions로 폴백
}

export interface AgentStorage {
  load(): AgentSettings | null;
  save(s: AgentSettings): void;
}

const DEFAULT_SETTINGS: AgentSettings = {
  reasoning_effort: "none",
  instructions: "",
};

function coerceEffort(v: unknown): ReasoningEffort {
  return REASONING_EFFORTS.includes(v as ReasoningEffort) ? (v as ReasoningEffort) : "none";
}

function coerceInstructions(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.length > INSTRUCTIONS_MAX_LEN ? v.slice(0, INSTRUCTIONS_MAX_LEN) : v;
}

function coerce(v: unknown): AgentSettings {
  const s = (v ?? {}) as Record<string, unknown>;
  return {
    reasoning_effort: coerceEffort(s.reasoning_effort),
    instructions: coerceInstructions(s.instructions),
  };
}

function equals(a: AgentSettings, b: AgentSettings): boolean {
  return a.reasoning_effort === b.reasoning_effort && a.instructions === b.instructions;
}

export function createAgentSettings(opts?: { storage?: AgentStorage; initial?: AgentSettings }) {
  const storage = opts?.storage;

  let stored: AgentSettings | null = null;
  if (storage) {
    try {
      const loaded = storage.load();
      if (loaded !== null) stored = coerce(loaded);
    } catch {
      // storage 오류 시 기본값으로 폴백
    }
  }

  // 우선순위: 저장값 > initial > 기본값
  let state: AgentSettings = stored
    ? { ...stored }
    : opts?.initial
      ? coerce(opts.initial)
      : { ...DEFAULT_SETTINGS };

  const subscribers = new Set<(s: AgentSettings) => void>();

  function notify(): void {
    const copy = { ...state };
    for (const cb of subscribers) cb(copy);
  }

  return {
    get(): AgentSettings {
      return { ...state };
    },

    setReasoningEffort(e: ReasoningEffort): void {
      const next = coerceEffort(e);
      if (state.reasoning_effort === next) return;
      state = { ...state, reasoning_effort: next };
      storage?.save({ ...state });
      notify();
    },

    setInstructions(s: string): void {
      const next = coerceInstructions(s);
      if (state.instructions === next) return;
      state = { ...state, instructions: next };
      storage?.save({ ...state });
      notify();
    },

    reloadFromStorage(): void {
      if (!storage) return;
      let loaded: AgentSettings | null;
      try {
        loaded = storage.load();
      } catch {
        return;
      }
      if (loaded === null) return;
      const next = coerce(loaded);
      if (equals(state, next)) return;
      state = next;
      notify();
    },

    subscribe(cb: (s: AgentSettings) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 AgentStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageAgentStorage(key = "yui.agent"): AgentStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as AgentSettings;
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
