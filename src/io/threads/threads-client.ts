/** The webview side of the Thread store: the newest snapshot it has seen and the user's read mark. */

import { invoke } from "@tauri-apps/api/core";
import type { Thread, ThreadsSnapshot } from "../../contract";
import { isTauri } from "../../tauri-env";
import { createSnapshotFeed, type SnapshotFeed } from "../snapshot-feed/snapshot-feed";

export interface ThreadsClient extends SnapshotFeed<ThreadsSnapshot> {
  /** The snapshot's Thread list; empty before the first snapshot, and always off Tauri. */
  threads(): Thread[];
  /** Marks the Thread read; rejects with the store's error string. */
  read(id: string): Promise<void>;
}

export function createThreadsClient(): ThreadsClient {
  const feed = createSnapshotFeed<ThreadsSnapshot>("threads-snapshot", "threads_snapshot");
  return {
    ...feed,
    threads: () => feed.snapshot()?.threads ?? [],
    async read(id) {
      if (!isTauri()) return;
      await invoke<void>("thread_read", { id });
    },
  };
}
