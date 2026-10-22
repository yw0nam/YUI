/** One exclusive Web Lock a window takes, holds until `release()`, and gives up when it dies. */
export interface ExclusiveHold {
  /** Resolves once this window may proceed: at once when the hold is off, when no lock manager exists, or when the signal is already aborted; an abort while waiting resolves without holding. */
  acquire(signal: AbortSignal): Promise<void>;
  /** Ends the hold; a no-op when nothing is held. */
  release(): void;
}

export function createExclusiveHold(deps: {
  name: string;
  enabled: () => boolean;
  locks?: Pick<LockManager, "request">;
  /** When set, a free lock is probed first. Called when another window holds it; the returned function runs when this window's wait ends in a grant. */
  onWait?: () => () => void;
  /** An acquire while this window already holds the lock resolves at once. */
  reentrant?: boolean;
}): ExclusiveHold {
  const locks = deps.locks ?? globalThis.navigator?.locks;
  let release: (() => void) | undefined;
  return {
    acquire(signal) {
      if (!deps.enabled() || !locks || signal.aborted || (deps.reentrant && release)) {
        return Promise.resolve();
      }
      return new Promise<void>((granted) => {
        // The lock stays held while the callback's promise is pending, so release() is what frees it.
        const hold = () => {
          granted();
          // A grant already scheduled when the abort landed still runs; returning frees the lock.
          if (signal.aborted) return;
          return new Promise<void>((r) => {
            release = r;
          });
        };
        const wait = (onGrant?: () => void) =>
          locks
            .request(deps.name, { signal }, () => {
              onGrant?.();
              return hold();
            })
            .catch(() => granted());
        if (!deps.onWait) {
          void wait();
          return;
        }
        // `signal` cannot ride an ifAvailable request, so the waiting request is a second one.
        const onWait = deps.onWait;
        locks
          .request(deps.name, { ifAvailable: true }, (lock) => {
            if (lock) return hold();
            void wait(onWait());
          })
          .catch(() => granted());
      });
    },
    release() {
      release?.();
      release = undefined;
    },
  };
}
