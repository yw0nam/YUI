/** The waiting-Threads count behind the `threads:` client-context line. */

import type { ClientContext, Thread } from "../../contract";

/** Counts the Threads waiting for the user's answer, grouped by source, count desc then source name. */
export function threadsWaiting(threads: Thread[]): NonNullable<ClientContext["threads_waiting"]> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (thread.state !== "input-required") continue;
    counts.set(thread.source, (counts.get(thread.source) ?? 0) + 1);
  }
  const by_source = [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  return {
    total: by_source.reduce((total, group) => total + group.count, 0),
    by_source,
  };
}
