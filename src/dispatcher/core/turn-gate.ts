import type { Logger } from "../../logger";
import { createLogger } from "../../logger";

/** One turn at a time across pet windows: an exclusive Web Lock held from a turn's backend call to the end of its playback. */
const TURN_LOCK_NAME = "yui.turn";

const baseLog = createLogger("turn-gate");

export interface TurnGate {
  /** Resolves once this window may call the backend: at once when the gate is off, when no lock manager exists, when this window already holds it, or when the signal is already aborted; an abort while waiting resolves without holding. */
  acquire(signal: AbortSignal): Promise<void>;
  /** Ends the hold; a no-op when nothing is held. */
  release(): void;
}

export function createTurnGate(deps: {
  enabled: () => boolean;
  locks?: Pick<LockManager, "request">;
  logger?: Logger;
  now?: () => number;
}): TurnGate {
  const locks = deps.locks ?? globalThis.navigator?.locks;
  const log = deps.logger ?? baseLog;
  const now = deps.now ?? Date.now;
  let release: (() => void) | undefined;
  return {
    acquire(signal) {
      if (!deps.enabled() || !locks || signal.aborted || release) return Promise.resolve();
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
        // `signal` cannot ride an ifAvailable request, so the waiting request is a second one.
        locks
          .request(TURN_LOCK_NAME, { ifAvailable: true }, (lock) => {
            if (lock) return hold();
            log.info("turn_hold", {});
            const waitingSince = now();
            locks
              .request(TURN_LOCK_NAME, { signal }, () => {
                log.info("turn_granted", { waited_ms: now() - waitingSince });
                return hold();
              })
              .catch(() => granted());
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
