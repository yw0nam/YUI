/** Builds the plain rows yui.waiting reads from the dispatcher's list and the signal buffers. */

import { waitedItemOf } from "../../dispatcher/backend/context-builder";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import type { SignalsSource } from "../../dispatcher/sources/inbox/signals-source";
import type { WaitingItem } from "../../io/chat/tools/run/waiting-api";

export interface WaitingSources {
  dispatcher: Pick<Dispatcher, "waiting">;
  signals: Pick<SignalsSource, "peek">;
}

type Projected = ReturnType<typeof waitedItemOf>;

/** The plain kind a row shows; a screen reaction reads as `screen`, not its trigger kind. */
function kindOf(item: Projected): string {
  if (item.screen) return "screen";
  if (item.milestone) return "milestone";
  if (item.addressed) return "addressed";
  return item.kind;
}

function labelOf(item: Projected): string | undefined {
  if (item.screen) return item.screen.app ?? item.screen.transition;
  if (item.milestone) return item.milestone.name;
  if (item.addressed) return item.addressed.from;
  return item.cue?.label;
}

export function waitingItemsOf(sources: WaitingSources): WaitingItem[] {
  const entries = sources.dispatcher.waiting().map(({ id, env }) => {
    const item = waitedItemOf(env);
    const label = labelOf(item);
    return {
      id,
      kind: kindOf(item),
      ...(label === undefined ? {} : { label }),
      at: item.at,
      detail: item,
    };
  });
  const groups = sources.signals.peek().map((group) => ({
    id: `sig:${group.envelope.event_id}`,
    kind: "signal",
    label: `${group.envelope.source}/${group.envelope.event_type}`,
    at: group.envelope.occurred_at,
    detail: group,
  }));
  return [...entries, ...groups];
}
