/** address_character: names the character a reply is for, so that character receives a turn. */

import { createLogger } from "../../../logger";
import type { PresetEntry } from "../../../settings/preset/active-preset";
import { targetLabel } from "../../../settings/relations/relation-targets";
import type { ClientTool } from "./client-tools";

const log = createLogger("address-character");

const DESCRIPTION =
  "Speak to another character: name who this reply is for. They hear this reply and may answer. " +
  "Once per reply; leave it out when you are talking to the user.";

/** Turns whose addressed targets are kept, so overlapping push turns stay apart. */
const TURNS_KEPT = 8;

export function createAddressCharacterTool(deps: {
  /** The other open presets, read each time the schema is built and when a call runs. */
  targets: () => PresetEntry[];
  /** Records the reply's recipient on its turn; the producer turns it into the event when the turn is over. */
  record: (turnId: string, to: string) => void;
}): ClientTool {
  const addressed = new Map<string, string>();

  /** Label to target id — the other open presets only; the user is not a target. */
  const labels = (): Map<string, string> =>
    new Map(deps.targets().map(({ id, name }): [string, string] => [targetLabel(name), id]));

  return {
    name: "address_character",
    get definition() {
      return {
        type: "function" as const,
        function: {
          name: "address_character",
          description: DESCRIPTION,
          parameters: {
            type: "object" as const,
            properties: {
              to: { type: "string", enum: [...labels().keys()] },
            },
            additionalProperties: false as const,
            required: ["to"],
          },
        },
      };
    },
    execute: async (args, _signal, call) => {
      if (typeof args.to !== "string") return "error: unknown target";
      const to = args.to;
      const id = labels().get(to);
      if (id === undefined) return "error: unknown target";
      const key = call?.turnId ?? "";
      if (addressed.has(key)) return `ignored: already addressed ${addressed.get(key)} this turn`;
      deps.record(key, id);
      addressed.delete(key);
      addressed.set(key, to);
      if (addressed.size > TURNS_KEPT) addressed.delete(addressed.keys().next().value as string);
      log.info("character_addressed", { to: id });
      return "ok";
    },
    waitMs: 2000,
  };
}
