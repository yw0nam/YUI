/** address_character: names the character a reply is for, so that character receives a turn. */

import { createLogger } from "../../../logger";
import type { PresetEntry } from "../../../settings/preset/active-preset";
import { targetLabel } from "../../../settings/relations/relation-targets";
import type { ClientTool } from "./client-tools";

const log = createLogger("address-character");

const DESCRIPTION =
  "Speak to another character: name who this reply is for. They hear this reply and may answer. " +
  "With handoff, this reply passes the user's message on this turn to that character, who takes it and answers the user. " +
  "Use handoff when the user's message is better answered by that character. " +
  "Once per reply; leave it out when you are talking to the user.";

export function createAddressCharacterTool(deps: {
  /** The other open presets, read when a call runs. */
  targets: () => PresetEntry[];
  /** Records the reply's recipient on its turn; returns the id recorded earlier, if any. */
  record: (turnId: string, to: string, handoff: boolean) => string | undefined;
}): ClientTool {
  /** Label to target id — the other open presets only; the user is not a target. */
  const labels = (): Map<string, string> =>
    new Map(deps.targets().map(({ id, name }): [string, string] => [targetLabel(name), id]));

  return {
    name: "address_character",
    definition: {
      type: "function" as const,
      function: {
        name: "address_character",
        description: DESCRIPTION,
        parameters: {
          type: "object" as const,
          properties: {
            to: { type: "string", description: "A name from the open characters: line." },
            handoff: {
              type: "boolean",
              description:
                "true: pass the user's message on this turn to that character, who answers the user.",
            },
          },
          additionalProperties: false as const,
          required: ["to"],
        },
      },
    },
    execute: async (args, _signal, call) => {
      if (typeof args.to !== "string") return "error: unknown target";
      const to = args.to;
      const id = labels().get(to);
      if (id === undefined) return "error: unknown target";
      const key = call?.turnId ?? "";
      const known = deps.record(key, id, args.handoff === true);
      if (known !== undefined) {
        const preset = deps.targets().find(({ id: targetId }) => targetId === known);
        return `ignored: already addressed ${preset ? targetLabel(preset.name) : known}`;
      }
      log.info("character_addressed", { to: id });
      return "ok";
    },
    waitMs: 2000,
  };
}
