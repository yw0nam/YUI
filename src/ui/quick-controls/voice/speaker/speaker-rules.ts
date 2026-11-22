/** What the speaker list decides from its selection store. */

import type { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";

type SpeakerSelection = ReturnType<typeof createSpeakerSelection>;

/** An id one of another provider's voices holds: it is not taken over. */
export function heldElsewhere(selection: SpeakerSelection, id: string): boolean {
  return (
    selection.listUser().some((o) => o.id === id) && !selection.list().some((o) => o.id === id)
  );
}

/** Drops an option from the store: the server owns every voice, and an imported one also has a store entry of its own. */
export function removeSpeakerOption(selection: SpeakerSelection, id: string): void {
  if (selection.list().find((o) => o.id === id)?.source === "user") selection.removeUserOption(id);
  else selection.removeBundledOption(id);
}
