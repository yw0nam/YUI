/** Unsent Answers, keyed by the ask they answer, so a draft never outlives its ask. */

import type { Thread, ThreadAsk } from "../../../contract";

export interface Draft {
  choice?: string;
  text: string;
}

/** Ask ids are unique only within a Thread, so the key carries both. */
export const draftKey = (threadId: string, askId: string): string => `${threadId}\n${askId}`;

/** Keeps each draft only as far as its ask, still open in `threads`, accepts it. */
export function pruneDrafts(drafts: Map<string, Draft>, threads: Thread[]): void {
  const asks = new Map<string, ThreadAsk>();
  for (const thread of threads) {
    if (thread.ask) asks.set(draftKey(thread.id, thread.ask.ask_id), thread.ask);
  }
  for (const [key, draft] of drafts) {
    const ask = asks.get(key);
    if (!ask) {
      drafts.delete(key);
      continue;
    }
    const choice = ask.choices.some((c) => c.id === draft.choice) ? draft.choice : undefined;
    drafts.set(key, { ...(choice ? { choice } : {}), text: ask.text ? draft.text : "" });
  }
}
