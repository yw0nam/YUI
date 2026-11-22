/** The monitor list's load: one request at a time, the state a view reads, and when a retry is due. */

import type {
  MonitorInfo,
  ScreenSourceProvider,
} from "../../../../io/window/capture/screen-source-provider";
import type { Logger } from "../../../../logger";

export type MonitorLoadState =
  | { kind: "idle" }
  | { kind: "list"; monitors: MonitorInfo[] }
  | { kind: "empty" }
  | { kind: "error" };

export interface MonitorLoad {
  /** The same object until the next change. */
  state(): MonitorLoadState;
  subscribe(cb: () => void): () => void;
  /** Lists the monitors; a call while one is in flight returns that request. */
  load(): Promise<void>;
  /** A list or an empty result is in; a failure leaves it false so the next trigger retries. */
  isLoaded(): boolean;
}

export function createMonitorLoad(deps: {
  sourceProvider: ScreenSourceProvider;
  log: Logger;
}): MonitorLoad {
  const { sourceProvider, log } = deps;
  let state: MonitorLoadState = { kind: "idle" };
  let loaded = false;
  let inflight: Promise<void> | undefined;
  const subscribers = new Set<() => void>();

  function set(next: MonitorLoadState): void {
    state = next;
    for (const cb of subscribers) cb();
  }

  async function request(): Promise<void> {
    let monitors: MonitorInfo[];
    try {
      monitors = await sourceProvider.listMonitors();
    } catch (err) {
      log.error("monitor_list_failed", { error: String(err) });
      set({ kind: "error" });
      return;
    }
    loaded = true;
    set(monitors.length === 0 ? { kind: "empty" } : { kind: "list", monitors });
  }

  return {
    state: () => state,
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    load() {
      inflight ??= request().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
    isLoaded: () => loaded,
  };
}
