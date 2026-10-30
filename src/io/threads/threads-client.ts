/** The webview side of the Thread store: the newest snapshot it has seen and the user's Answer. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Thread, ThreadsSnapshot } from "../../contract";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("threads-client");

export interface ThreadsClient {
  /** The highest-revision snapshot seen so far; null before the first one, and always off Tauri. */
  snapshot(): ThreadsSnapshot | null;
  /** The snapshot's Thread list; empty before the first snapshot, and always off Tauri. */
  threads(): Thread[];
  subscribe(listener: (snapshot: ThreadsSnapshot) => void): () => void;
  /** Rejects with the store's error string naming the broken rule. */
  answer(id: string, askId: string, answer: { choice?: string; text?: string }): Promise<void>;
  dispose(): void;
}

export function createThreadsClient(): ThreadsClient {
  let latest: ThreadsSnapshot | null = null;
  const listeners = new Set<(snapshot: ThreadsSnapshot) => void>();
  let unlisten: (() => void) | undefined;
  let disposed = false;

  // Event delivery can reorder snapshots, so only a higher revision replaces the kept one.
  const keep = (snapshot: ThreadsSnapshot): void => {
    if (latest !== null && snapshot.revision <= latest.revision) return;
    latest = snapshot;
    for (const listener of listeners) listener(snapshot);
  };

  // The read follows the subscription, so no event is lost between the two.
  const read = (): void => {
    void invoke<ThreadsSnapshot>("threads_snapshot").then(keep, (err) =>
      log.warn("snapshot.invoke_failed", { error: String(err) }),
    );
  };

  if (isTauri()) {
    void listen<ThreadsSnapshot>("threads-snapshot", (event) => keep(event.payload)).then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
        read();
      },
      (err) => {
        log.warn("snapshot.listen_failed", { error: String(err) });
        read();
      },
    );
  }

  return {
    snapshot: () => latest,
    threads: () => latest?.threads ?? [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async answer(id, askId, answer) {
      if (!isTauri()) return;
      await invoke<void>("thread_answer", { id, askId, ...answer });
    },
    dispose() {
      disposed = true;
      unlisten?.();
    },
  };
}
