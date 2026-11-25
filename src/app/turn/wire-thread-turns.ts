/** Main only: each Threads snapshot runs through Thread turns; every group it returns goes to the signals source, and the buffered input-required group of a Thread that left input-required is withdrawn. A null client wires nothing. */

import type { SignalGroup, ThreadsSnapshot } from "../../contract";
import {
  createThreadTurns,
  THREAD_INPUT_REQUIRED,
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
    const { groups, stoppedWaiting } = turns.next(snapshot, deps.level());
    for (const group of groups) deps.offer(group);
    for (const id of stoppedWaiting) deps.withdraw(threadEventId(id), THREAD_INPUT_REQUIRED);
  };
  const current = threads.snapshot();
  if (current) feed(current);
  return threads.subscribe(feed);
}
