/**
 * Reactive settings store managing AI agent request shaping: reasoning effort, the preset's card, and
 * whether the card is sent. Persists to storage on change and notifies subscribers.
 */

import { readCard } from "../../config/validators/persona/read-card";
import { type Card, EMPTY_CARD } from "../../config/validators/persona/types";
import {
  createPersistedStore,
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../persisted-store";

export type ReasoningEffort = "default" | "none" | "minimal" | "low" | "medium";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
];

export interface AgentSettings {
  reasoning_effort: ReasoningEffort; // reasoning.effort value sent to the backend ("default" => none sent, the model decides)
  send_card: boolean;
  card: Card | null; // null => the default card of the UI language
}

export type AgentStorage = PersistedStorage<AgentSettings>;

const DEFAULT_SETTINGS: AgentSettings = {
  reasoning_effort: "default",
  send_card: true,
  card: null,
};

function coerceEffort(v: unknown): ReasoningEffort {
  return REASONING_EFFORTS.includes(v as ReasoningEffort) ? (v as ReasoningEffort) : "default";
}

function coerceCard(s: Record<string, unknown>): Card | null {
  if ("card" in s) {
    const read = readCard(s.card);
    return read.issues.length ? null : read.card;
  }
  // A stored `instructions` string is an own card whose system prompt is that string.
  if (typeof s.instructions === "string" && s.instructions) {
    return readCard({ ...EMPTY_CARD, system_prompt: s.instructions }).card;
  }
  return null;
}

function coerce(s: Record<string, unknown>): AgentSettings {
  return {
    reasoning_effort: coerceEffort(s.reasoning_effort),
    send_card: s.send_card !== false,
    card: coerceCard(s),
  };
}

/** The stored shape normalized: a missing or non-object value reads as the defaults. */
export function coerceAgentSettings(value: unknown): AgentSettings {
  return isPlainObject(value) ? coerce(value as Record<string, unknown>) : { ...DEFAULT_SETTINGS };
}

export function createAgentSettings(opts?: { storage?: AgentStorage }) {
  const core = createPersistedStore<AgentSettings>({
    storage: opts?.storage,
    defaults: DEFAULT_SETTINGS,
    // A non-object is rejected so a corrupted stored value cannot erase in-memory settings.
    parse: (v) => (isPlainObject(v) ? coerce(v as Record<string, unknown>) : null),
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    clone: (v) => structuredClone(v),
  });

  const commit = (patch: Partial<AgentSettings>): void =>
    core.commit({ ...core.current(), ...patch });

  return {
    get: core.get,

    setReasoningEffort(e: ReasoningEffort): void {
      commit({ reasoning_effort: coerceEffort(e) });
    },

    setCard(card: Card): void {
      commit({ card: readCard(card).card });
    },

    /** Patches the own card, or a copy of `base` (the resolved default card) while the card is the default. */
    updateCard(patch: Partial<Card>, base: Card): void {
      commit({ card: readCard({ ...(core.current().card ?? base), ...patch }).card });
    },

    resetCard(): void {
      commit({ card: null });
    },

    setSendCard(on: boolean): void {
      commit({ send_card: on });
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
