/** thread-turns — diffs Thread snapshots and returns the signal groups a Thread turns level asks for. */

import type { SignalGroup, SignalItem, Thread, ThreadsSnapshot } from "../../../contract";
import { oneLine } from "../../../io/chat/one-line";
import { LAST_CUT } from "../../../io/chat/tools/threads/thread-text";
import type { ThreadTurnsLevel } from "../../../settings/threads/thread-turns-settings";

type Seen = { askIds: Set<string>; state?: Thread["state"]; entryCount: number };

function eventType(thread: Thread, seen: Seen, level: ThreadTurnsLevel): string | undefined {
  if (level === "notable") {
    if (thread.ask && !seen.askIds.has(thread.ask.ask_id)) return "thread.ask";
    if (thread.state === "failed" && seen.state !== "failed") return "thread.failed";
  }
  if (level === "every") {
    const added = Math.min(thread.entry_count - seen.entryCount, thread.entries.length);
    if (added > 0 && thread.entries.slice(-added).some((entry) => entry.role !== "user"))
      return "thread.entry";
  }
  return undefined;
}

function groupOf(thread: Thread, event_type: string): SignalGroup {
  const last = thread.entries.at(-1);
  const item: SignalItem = {
    thread_id: thread.id,
    title: oneLine(thread.title),
    ...(thread.label && { label: oneLine(thread.label) }),
    state: thread.state,
    ...(thread.ask && { ask: oneLine(thread.ask.prompt) }),
    ...(last && { last: { role: last.role, text: oneLine(last.text).slice(0, LAST_CUT) } }),
  };
  return {
    envelope: {
      source: thread.source,
      event_type,
      delivery: "batched",
      event_id: `thread:${thread.id}`,
      occurred_at: thread.updated_at,
      label: thread.title,
    },
    items: [item],
  };
}

export function createThreadTurns(): {
  /** Diffs `snapshot` against the last one seen and returns the groups `level` asks for. The first call is the baseline and returns []. */
  next(snapshot: ThreadsSnapshot, level: ThreadTurnsLevel): SignalGroup[];
} {
  let seenById: Map<string, Seen> | undefined;
  return {
    next(snapshot, level) {
      const baseline = seenById === undefined;
      const previous = seenById ?? new Map<string, Seen>();
      seenById = new Map();
      const groups: SignalGroup[] = [];
      for (const thread of snapshot.threads) {
        const seen = previous.get(thread.id) ?? { askIds: new Set(), entryCount: 0 };
        const type = baseline ? undefined : eventType(thread, seen, level);
        if (type) groups.push(groupOf(thread, type));
        if (thread.ask) seen.askIds.add(thread.ask.ask_id);
        seenById.set(thread.id, { ...seen, state: thread.state, entryCount: thread.entry_count });
      }
      return groups;
    },
  };
}
