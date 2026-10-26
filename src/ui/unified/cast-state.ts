/** Each open character's state in the unified window: its turn state and the name its window last sent, and the rule for its chip. */

import type { PresetEntry } from "../../settings/preset/active-preset";
import type { CastState } from "./cast-chips";
import type { LaneQueue } from "./lane-queue";

export function createCastState(deps: {
  cast: () => PresetEntry[];
  lanes: Pick<LaneQueue, "speaker" | "waiting">;
}) {
  const busy = new Map<string, boolean>();
  const names = new Map<string, string>();
  const thinking = (id: string): boolean => busy.get(id) === true || deps.lanes.waiting(id);
  return {
    setBusy: (preset: string, on: boolean): void => void busy.set(preset, on),
    setName: (preset: string, name: string): void => void names.set(preset, name),
    /** The name the preset's window last sent, else its registry name. */
    nameOf: (id: string): string =>
      names.get(id) ?? deps.cast().find((e) => e.id === id)?.name ?? id,
    /** talk while its line holds the box, think while its turn runs or its line waits, else idle. */
    stateOf: (id: string): CastState =>
      deps.lanes.speaker() === id ? "talk" : thinking(id) ? "think" : "idle",
    /** Whether a line holds the box, or an open character's turn runs or its line waits. */
    running: (): boolean =>
      deps.lanes.speaker() !== null || deps.cast().some((e) => thinking(e.id)),
    /** Forgets the turn state of a preset that left the cast. */
    prune(): void {
      const ids = deps.cast().map((e) => e.id);
      for (const id of busy.keys()) if (!ids.includes(id)) busy.delete(id);
    },
  };
}
