import type { Card } from "../../../config/validators/persona/types";

interface MacroValues {
  charName: string;
  userName: string;
  original: string;
}

const MACRO = /\{\{\s*(char|user|original)\s*\}\}/gi;

/** One pass over `text`: `{{char}}`, `{{user}}`, `{{original}}` are replaced, nothing else is touched. */
export function substituteMacros(text: string, values: MacroValues): string {
  return text.replace(MACRO, (_m, name: string) => {
    const key = name.toLowerCase();
    return key === "char" ? values.charName : key === "user" ? values.userName : values.original;
  });
}

/** The card as the first system message and the post-history system message; pure, so equal input gives equal bytes. */
export function assembleCard(input: {
  card: Card;
  framing: string;
  charName: string;
  userName: string;
  chatInstructions: string | undefined;
}): { system: string; postHistory: string } {
  const { card, charName, userName, chatInstructions } = input;
  const framing = substituteMacros(input.framing, { charName, userName, original: "" });
  const blocks = [
    card.system_prompt || framing,
    card.description,
    card.personality && `Personality: ${card.personality}`,
    card.scenario && `Scenario: ${card.scenario}`,
    card.mes_example && `Example dialogue:\n${card.mes_example}`,
    chatInstructions,
  ].filter(Boolean);
  return {
    system: substituteMacros(blocks.join("\n\n"), { charName, userName, original: framing }),
    postHistory: substituteMacros(card.post_history_instructions, {
      charName,
      userName,
      original: "",
    }),
  };
}
