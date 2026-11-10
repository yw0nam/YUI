/** Main only: each Threads snapshot runs through Thread turns; every group it returns goes to the signals source, and a closed ask's buffered group is withdrawn. A null client wires nothing. */

import type { SignalGroup, ThreadsSnapshot } from "../../contract";
import {
  createThreadTurns,
  THREAD_ASK,
  threadEventId,
} from "../../dispatcher/sources/threads/thread-turns";
import type { ThreadsClient } from "../../io/threads/threads-client";
import type { ThreadTurnsLevel } from "../../settings/threads/thread-turns-settings";

export function wireThreadTurns(deps: {
  threads: Pick<ThreadsClient, "snapshot" | "subscribe"> | null;
  level: () => ThreadTurnsLevel;
  offer: (group: SignalGroup) => void;
  withdraw: (eventId: string, eventType: string) => void;
}): () => void {
  const { threads } = deps;
  if (!threads) return () => {};
  const turns = createThreadTurns();
  const feed = (snapshot: ThreadsSnapshot): void => {
    const { groups, closed } = turns.next(snapshot, deps.level());
    for (const group of groups) deps.offer(group);
    for (const id of closed) deps.withdraw(threadEventId(id), THREAD_ASK);
  };
  const current = threads.snapshot();
  if (current) feed(current);
  return threads.subscribe(feed);
}
