import { describe, expect, it } from "vitest";
import { personaFixture } from "../../../config/load-test-helpers";
import { EMPTY_CARD } from "../../../config/validators/persona/types";
import { cardName, resolveCard } from "./resolve-card";

const CARD = { ...EMPTY_CARD, name: "Mira" };

describe("cardName", () => {
  it.each([
    [{ id: "default", name: "default" }, "Mira"],
    [{ id: "default", name: "Ren" }, "Ren"],
    [{ id: "p1", name: "default" }, "default"],
  ])("preset %o → %s", (entry, name) => {
    expect(cardName(CARD, entry)).toBe(name);
  });
});

describe("resolveCard", () => {
  const settings = { reasoning_effort: "none" as const, send_card: true, card: null };
  const base = {
    settings,
    locale: "ja" as const,
    persona: personaFixture(),
    presetEntry: { id: "default", name: "default" },
  };

  it("resolves the default card of the UI language", () => {
    expect(resolveCard({ ...base, chatApi: "chat_completions" })).toEqual({
      card: personaFixture().cards.ja,
      charName: "Yui",
    });
  });

  it.each([
    ["push", settings],
    ["responses", { ...settings, send_card: false }],
  ] as const)("is null on %s or with the switch off", (chatApi, s) => {
    expect(resolveCard({ ...base, settings: s, chatApi })).toBeNull();
  });
});
