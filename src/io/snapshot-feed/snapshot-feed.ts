/** The webview side of a Rust store's snapshots: the highest revision seen on its event or read by its command. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("snapshot-feed");

export interface SnapshotFeed<T> {
  /** The highest-revision snapshot seen so far; null before the first one, and always off Tauri. */
  snapshot(): T | null;
  subscribe(listener: (snapshot: T) => void): () => void;
  dispose(): void;
}

/** Listens on `event`, then reads `command`, so no snapshot is lost between the two; inert off Tauri. */
export function createSnapshotFeed<T extends { revision: number }>(
  event: string,
  command: string,
): SnapshotFeed<T> {
  let latest: T | null = null;
  const listeners = new Set<(snapshot: T) => void>();
  let unlisten: (() => void) | undefined;
  let disposed = false;

  // Event delivery can reorder snapshots, so only a higher revision replaces the kept one.
  const keep = (snapshot: T): void => {
    if (latest !== null && snapshot.revision <= latest.revision) return;
    latest = snapshot;
    for (const listener of listeners) listener(snapshot);
  };

  const read = (): void => {
    void invoke<T>(command).then(keep, (err) =>
      log.warn("snapshot.invoke_failed", { command, error: String(err) }),
    );
  };

  if (isTauri()) {
    void listen<T>(event, (e) => keep(e.payload)).then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
        read();
      },
      (err) => {
        log.warn("snapshot.listen_failed", { event, error: String(err) });
        read();
      },
    );
  }

  return {
    snapshot: () => latest,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      unlisten?.();
    },
  };
}
