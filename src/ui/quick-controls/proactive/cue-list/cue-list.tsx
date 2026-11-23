/** The cue rows of one cue list, then its add row. */

import type { Cue, createCueListSettings } from "../../../../settings/cues/cue-list-settings";

type CueStore<C extends Cue> = Pick<
  ReturnType<typeof createCueListSettings<C>>,
  "addCue" | "updateCue" | "removeCue"
>;

export interface CueListProps<C extends Cue> {
  entries: C[];
  store: CueStore<C>;
  trigger: { kind: "time"; field: "time" } | { kind: "minutes"; field: "idle_min" };
  addLabel: string;
}

export function CueList<C extends Cue>(_props: CueListProps<C>) {
  return null;
}
