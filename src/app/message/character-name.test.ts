import { expect, it, vi } from "vitest";
import type { Card, PersonaConfig } from "../../config/validators/persona/types";
import type { PresetState } from "../../settings/preset/active-preset";
import { createCharacterName } from "./character-name";

const card = (name: string): Card => ({ name }) as Card;
const persona = { cards: { en: card("YUI"), ja: card("YUI"), ko: card("YUI") } } as PersonaConfig;

function setup(state: PresetState, custom: Card | null = null) {
  const name = createCharacterName({
    registry: { get: () => state, subscribe: () => () => {} },
    boundId: null,
    agentSettings: { get: () => ({ card: custom }), subscribe: () => () => {} },
  });
  return name;
}

it("names the unnamed built-in preset by its card once the persona loads, the preset's name before", () => {
  const name = setup({ active: "default", list: [{ id: "default", name: "default" }] });
  expect(name.get()).toBe("default");
  const changed = vi.fn();
  name.subscribe(changed);
  name.setPersona(persona);
  expect(changed).toHaveBeenCalledOnce();
  expect(name.get()).toBe("YUI");
});

it("names it by the user's own card when one is set, and a named preset by its own name", () => {
  const custom = setup(
    { active: "default", list: [{ id: "default", name: "default" }] },
    card("Mina"),
  );
  custom.setPersona(persona);
  expect(custom.get()).toBe("Mina");

  const named = setup({ active: "perlica", list: [{ id: "perlica", name: "Perlica" }] });
  named.setPersona(persona);
  expect(named.get()).toBe("Perlica");
});
