/**
 * turn-feed — the one consumer of tool-chip states and reasoning cycles from every transport.
 *
 * Each transport turns its own wire into calls here under an owner that names one of its turns,
 * and the feed keeps the two shared slots: the running tool and the live reasoning cycle. Every
 * slot change is checked against the owner that holds it, so a superseded turn's late frames
 * leave a newer turn's chip and text alone.
 */

import type { ToolStatus } from "../../contract";
import type { ReasoningStore } from "../../io/bridge/reasoning-store";

/** `<source>:<id>` — e.g. `stream:12`, `push:turn:1789365854947`. */
export type Owner = string;

export interface TurnFeed {
  /**
   * A tool state of this owner's turn. The chip is one slot: a `running` always takes it, and any
   * other state from an owner that does not hold it is ignored.
   */
  toolStatus(owner: Owner, state: ToolStatus["state"], toolId: string | undefined): void;
  /** A reasoning delta. A delta from a new owner abandons the live cycle: the newest turn wins. */
  reasoning(owner: Owner, delta: string): void;
  /** The owner's reply landed: closes its cycle. `full` replaces the streamed text when given. */
  replied(owner: Owner, full?: string): void;
  /** The owner's turn is over however it ended: its running tool goes idle, its live cycle dies. */
  ended(owner: Owner): void;
  /** A source's connection or wiring went away: `ended` for every slot one of its owners holds. */
  sourceLost(source: string): void;
}

export function createTurnFeed(deps: {
  onToolStatus: (status: ToolStatus) => void;
  reasoning: Pick<ReasoningStore, "append" | "finish" | "interrupt">;
}): TurnFeed {
  let toolOwner: Owner | null = null;
  let cycleOwner: Owner | null = null;

  function endTool(owner: Owner): void {
    if (toolOwner !== owner) return;
    toolOwner = null;
    deps.onToolStatus({ state: "idle" });
  }

  function endCycle(owner: Owner): void {
    if (cycleOwner !== owner) return;
    cycleOwner = null;
    deps.reasoning.interrupt();
  }

  return {
    toolStatus(owner, state, toolId) {
      if (state === "running") {
        toolOwner = owner;
      } else if (toolOwner !== null && toolOwner !== owner) {
        // A late state of an older turn must not clear a newer turn's running chip.
        return;
      } else {
        toolOwner = null;
      }
      deps.onToolStatus({ state, tool_id: toolId });
    },

    reasoning(owner, delta) {
      // An empty delta must not take the cycle from the owner that holds it.
      if (delta === "") return;
      if (cycleOwner !== null && cycleOwner !== owner) deps.reasoning.interrupt();
      cycleOwner = owner;
      deps.reasoning.append(delta);
    },

    replied(owner, full) {
      // Another owner's live cycle keeps streaming; with no cycle live, a reply without
      // reasoning still clears the previous finished text.
      if (cycleOwner !== null && cycleOwner !== owner) return;
      cycleOwner = null;
      deps.reasoning.finish(full);
    },

    ended(owner) {
      endTool(owner);
      endCycle(owner);
    },

    sourceLost(source) {
      const prefix = `${source}:`;
      if (toolOwner?.startsWith(prefix)) endTool(toolOwner);
      if (cycleOwner?.startsWith(prefix)) endCycle(cycleOwner);
    },
  };
}
