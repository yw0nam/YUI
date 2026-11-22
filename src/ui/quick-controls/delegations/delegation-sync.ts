import type { DelegationItem } from "../../../io/chat/push/push-frames";
import { DELEGATION_REFRESH_MS } from "../../chips/delegation-rows";

interface DelegationSyncDeps {
  /** Delegated-work list; absent where nothing mirrors it. */
  delegations?: { get(): DelegationItem[]; refresh?(): void };
  /** Redraw of the session section's delegated list. */
  reflectDelegations: () => void;
}

interface DelegationSync {
  /** Redraw the list, then arm or clear the minute refresh to match whether any item runs. */
  sync(): void;
  /** Clear a pending minute refresh; the handle is left as is. */
  stop(): void;
}

export function createDelegationSync({
  delegations,
  reflectDelegations,
}: DelegationSyncDeps): DelegationSync {
  // The session section's delegated list re-renders on every list change; a once-a-minute refresh keeps
  // the elapsed text current while something is running.
  let delegationsTimer: ReturnType<typeof setInterval> | null = null;
  function sync(): void {
    reflectDelegations();
    if (!delegations) return;
    const has = delegations.get().some((item) => item.state === "running");
    if (has && delegationsTimer === null) {
      delegationsTimer = setInterval(() => {
        delegations.refresh?.();
        reflectDelegations();
      }, DELEGATION_REFRESH_MS);
    } else if (!has && delegationsTimer !== null) {
      clearInterval(delegationsTimer);
      delegationsTimer = null;
    }
  }

  function stop(): void {
    if (delegationsTimer !== null) clearInterval(delegationsTimer);
  }

  return { sync, stop };
}
