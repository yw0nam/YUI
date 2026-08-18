/**
 * Reactive settings store managing AI agent request shaping (reasoning effort + system instructions override).
 * Persists to storage on change and notifies subscribers.
 */

import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "./persisted-store";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium"];
export const INSTRUCTIONS_MAX_LEN = 4000;

export interface AgentSettings {
  reasoning_effort: ReasoningEffort; // reasoning.effort value sent to the backend ("none" => no reasoning)
  instructions: string; // "" => caller falls back to config.chat_instructions
}

export type AgentStorage = PersistedStorage<AgentSettings>;

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

export function createAgentSettings(opts?: { storage?: AgentStorage; initial?: AgentSettings }) {
  const core = createPersistedStore<AgentSettings>({
    storage: opts?.storage,
    initial: opts?.initial,
    defaults: { ...DEFAULT_SETTINGS },
    // A non-object is rejected so a corrupted stored value cannot erase in-memory/initial settings.
    parse: (v) => (isPlainObject(v) ? coerce(v) : null),
    fromInitial: coerce,
    equals: (a, b) =>
      a.reasoning_effort === b.reasoning_effort && a.instructions === b.instructions,
  });

  return {
    get: core.get,

    setReasoningEffort(e: ReasoningEffort): void {
      core.commit({ ...core.current(), reasoning_effort: coerceEffort(e) });
    },

    setInstructions(s: string): void {
      core.commit({ ...core.current(), instructions: coerceInstructions(s) });
    },

    reloadFromStorage: core.reloadFromStorage,
    subscribe: core.subscribe,
    dispose: core.dispose,
  };
}

/** localStorage-based AgentStorage adapter. Gracefully ignored in environments without localStorage. */
export function localStorageAgentStorage(key = "yui.agent"): AgentStorage {
  return localStorageStore<AgentSettings>(key);
}
