import { describe, expect, it } from "vitest";
import { type Card, EMPTY_CARD } from "../../../config/validators/persona/types";
import { assembleCard } from "./assemble-card";

const FRAMING = "You are {{char}}, on {{user}}'s desktop.";

function assemble(card: Partial<Card>, chatInstructions: string | undefined = "Use the tool.") {
  return assembleCard({
    card: { ...EMPTY_CARD, ...card },
    framing: FRAMING,
    charName: "Mira",
    userName: "Sam",
    chatInstructions,
  });
}

describe("assembleCard", () => {
  it("joins the blocks in order, with the chat instructions last", () => {
    const { system } = assemble({
      system_prompt: "Stay as {{char}}.",
      description: "{{char}} keeps a lighthouse.",
      personality: "quiet",
      scenario: "A storm.",
      mes_example: "{{user}}: hi\n{{char}}: hello",
    });
    expect(system).toBe(
      [
        "Stay as Mira.",
        "Mira keeps a lighthouse.",
        "Personality: quiet",
        "Scenario: A storm.",
        "Example dialogue:\nSam: hi\nMira: hello",
        "Use the tool.",
      ].join("\n\n"),
    );
  });

  it("drops an empty field's block with its label, and falls back to the framing", () => {
    const { system } = assemble({ description: "d" }, undefined);
    expect(system).toBe("You are Mira, on Sam's desktop.\n\nd");
    expect(system).not.toContain("Personality: ");
  });

  it("puts the resolved framing where the system prompt says {{original}}", () => {
    const { system } = assemble({ system_prompt: "{{original}} Never break character." }, "");
    expect(system).toBe("You are Mira, on Sam's desktop. Never break character.");
  });

  it("matches a macro regardless of spacing and case", () => {
    expect(assemble({ system_prompt: "I am {{ CHAR }} and you are {{User}}." }, "").system).toBe(
      "I am Mira and you are Sam.",
    );
  });

  it("substitutes the macros in the post-history instructions", () => {
    expect(assemble({ post_history_instructions: "{{char}} answers {{user}}." }).postHistory).toBe(
      "Mira answers Sam.",
    );
  });
});
