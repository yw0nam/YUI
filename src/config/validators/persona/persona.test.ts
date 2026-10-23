import { describe, expect, it } from "vitest";
import { ConfigError } from "../shared";
import { validatePersona } from "./persona";

function card(name: string) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description: "d",
      personality: "",
      scenario: "",
      first_mes: "hi",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "YUI",
      character_version: "1",
      extensions: {},
    },
  };
}

function persona(): any {
  return {
    framing: { en: "You are {{char}}.", ja: "{{char}}です。", ko: "{{char}}입니다." },
    user_fallback: { en: "User", ja: "ユーザー", ko: "사용자" },
    cards: { en: card("Yui"), ja: card("Yui"), ko: card("Yui") },
  };
}

describe("validatePersona", () => {
  it("unwraps each locale's envelope into its card", () => {
    const out = validatePersona("persona.json", persona());
    expect(out.cards.ja.first_mes).toBe("hi");
    expect(out.user_fallback.ko).toBe("사용자");
  });

  it("names the file and the locale when a locale is missing", () => {
    const raw = persona();
    delete raw.framing.ja;
    expect(() => validatePersona("persona.json", raw)).toThrow(
      new ConfigError("persona.json", ["framing.ja must be a non-empty string (got: undefined)"]),
    );
  });

  it("names the locale and the field when a card field has the wrong type", () => {
    const raw = persona();
    raw.cards.ko.data.tags = "sea";
    expect(() => validatePersona("persona.json", raw)).toThrow(
      new ConfigError("persona.json", ['cards.ko.data.tags must be a string[] (got: "sea")']),
    );
  });
});
