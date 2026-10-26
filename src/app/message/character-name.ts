/** The name this window's character goes by: the card's effective name once the persona loads, the preset's before. */

import type { Card, PersonaConfig } from "../../config/validators/persona/types";
import { cardName } from "../../io/chat/card/resolve-card";
import { type PresetState, presetEntryFor } from "../../settings/preset/active-preset";
import { getLocale, subscribe as subscribeLocale } from "../../ui/i18n";

interface Source<T> {
  get(): T;
  subscribe(cb: () => void): () => void;
}

export interface CharacterName {
  get(): string;
  /** Calls back whenever the name may have changed. */
  subscribe(cb: () => void): () => void;
  setPersona(persona: PersonaConfig): void;
}

export function createCharacterName(deps: {
  registry: Source<PresetState>;
  boundId: string | null;
  agentSettings: Source<{ card: Card | null }>;
}): CharacterName {
  let persona: PersonaConfig | null = null;
  const listeners = new Set<() => void>();

  return {
    get() {
      const entry = presetEntryFor(deps.registry.get(), deps.boundId);
      if (!persona) return entry.name;
      return cardName(deps.agentSettings.get().card ?? persona.cards[getLocale()], entry);
    },
    subscribe(cb) {
      listeners.add(cb);
      const unsubscribe = [
        deps.registry.subscribe(cb),
        deps.agentSettings.subscribe(cb),
        subscribeLocale(cb),
      ];
      return () => {
        listeners.delete(cb);
        for (const off of unsubscribe) off();
      };
    },
    setPersona(next) {
      persona = next;
      for (const cb of listeners) cb();
    },
  };
}
