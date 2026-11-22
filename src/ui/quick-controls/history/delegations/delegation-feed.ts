/** The delegated list a React page reads: its sync controller, and a version that moves on every redraw the controller asks for. */

import type { DelegationItem } from "../../../../io/chat/push/push-frames";
import { createDelegationSync } from "./delegation-sync";

export interface DelegationFeed {
  /** Whether a delegations list was given. */
  present: boolean;
  get(): DelegationItem[];
  version(): number;
  subscribe(cb: () => void): () => void;
  /** Redraw, then arm or clear the minute refresh. */
  sync(): void;
  /** Releases the list's subscription, then clears the minute refresh. */
  dispose(): void;
}

export function createDelegationFeed(delegations?: {
  get(): DelegationItem[];
  subscribe(cb: () => void): () => void;
  refresh?(): void;
}): DelegationFeed {
  let version = 0;
  const listeners = new Set<() => void>();
  const { sync, stop } = createDelegationSync({
    delegations,
    reflectDelegations() {
      version++;
      for (const cb of [...listeners]) cb();
    },
  });
  const unsubscribe = delegations?.subscribe(sync);

  return {
    present: delegations !== undefined,
    get: () => delegations?.get() ?? [],
    version: () => version,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    sync,
    dispose() {
      unsubscribe?.();
      stop();
    },
  };
}
