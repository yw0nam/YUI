/** Main only: each Threads snapshot runs through Thread turns, and every group it returns goes to the signals source. */

import type { SignalGroup, ThreadsSnapshot } from "../../contract";
import { createThreadTurns } from "../../dispatcher/sources/threads/thread-turns";
import type { ThreadsClient } from "../../io/threads/threads-client";
import type { ThreadTurnsLevel } from "../../settings/threads/thread-turns-settings";

export function wireThreadTurns(deps: {
  threads: Pick<ThreadsClient, "snapshot" | "subscribe">;
  level: () => ThreadTurnsLevel;
  offer: (group: SignalGroup) => void;
}): () => void {
  const turns = createThreadTurns();
  const feed = (snapshot: ThreadsSnapshot): void => {
    for (const group of turns.next(snapshot, deps.level())) deps.offer(group);
  };
  const current = deps.threads.snapshot();
  if (current) feed(current);
  return deps.threads.subscribe(feed);
}
