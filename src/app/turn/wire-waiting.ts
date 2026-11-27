/** Builds the plain rows yui.waiting reads from the dispatcher's list and the signal buffers. */

import type { Dispatcher } from "../../dispatcher/dispatcher";
import type { SignalsSource } from "../../dispatcher/sources/inbox/signals-source";
import type { WaitingItem } from "../../io/chat/tools/run/waiting-api";

export interface WaitingSources {
  dispatcher: Pick<Dispatcher, "waiting">;
  signals: Pick<SignalsSource, "peek">;
}

export function waitingItemsOf(_sources: WaitingSources): WaitingItem[] {
  return [];
}
