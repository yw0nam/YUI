/** rate_relation: the backend moves this character's relation toward the user or another open preset. */

import { createLogger } from "../../../logger";
import { targetLabel } from "../../../settings/relations/relation-targets";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import type { ClientTool } from "./client-tools";

const log = createLogger("relation");

const DESCRIPTION =
  "Move how you feel toward the user or another character by one small step, with the reason, " +
  "after something they did or said; once per target per reply.";

const DELTAS = [-2, -1, 1, 2];
/** Turns whose rated targets are kept, so overlapping push turns stay apart. */
const TURNS_KEPT = 8;

export function createRateRelationTool(deps: {
  store: Pick<RelationsStore, "rate">;
  /** The other open presets, read each time the schema is built. */
  targets: () => { id: string; name: string }[];
  now?: () => number;
}): ClientTool {
  const now = deps.now ?? Date.now;
  const rated = new Map<string, Set<string>>();

  /** Label to target id; the bare `user` is always the human. */
  const labels = (): Map<string, string> =>
    new Map([
      ["user", "user"],
      ...deps.targets().map(({ id, name }): [string, string] => [targetLabel(name), id]),
    ]);

  return {
    name: "rate_relation",
    get definition() {
      return {
        type: "function" as const,
        function: {
          name: "rate_relation",
          description: DESCRIPTION,
          parameters: {
            type: "object" as const,
            properties: {
              toward: { type: "string", enum: [...labels().keys()] },
              delta: { type: "integer", enum: DELTAS },
              why: { type: "string", maxLength: 80 },
            },
            additionalProperties: false as const,
            required: ["toward", "delta", "why"],
          },
        },
      };
    },
    execute: async (args, _signal, call) => {
      const { toward, delta, why } = args;
      const id = typeof toward === "string" ? labels().get(toward) : undefined;
      if (id === undefined) return "error: unknown target";
      if (typeof delta !== "number" || !DELTAS.includes(delta)) return "error: invalid field delta";
      if (typeof why !== "string") return "error: invalid field why";
      const key = call?.turnId ?? "";
      const turn = rated.get(key) ?? new Set<string>();
      if (turn.has(id)) return `ignored: already rated ${toward} this turn`;
      const { band, applied, clamped } = deps.store.rate(id, delta, why, now());
      turn.add(id);
      rated.delete(key);
      rated.set(key, turn);
      if (rated.size > TURNS_KEPT) rated.delete(rated.keys().next().value as string);
      log.info("relation_rated", { target: id, delta: applied, band, clamped });
      return clamped ? `clamped: ${band}` : band;
    },
    waitMs: 2000,
  };
}
