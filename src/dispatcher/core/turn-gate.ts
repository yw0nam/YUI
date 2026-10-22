import { createExclusiveHold, type ExclusiveHold } from "../../io/locks/exclusive-hold";
import type { Logger } from "../../logger";
import { createLogger } from "../../logger";

/** One turn at a time across pet windows: an exclusive Web Lock held from a turn's backend call to the end of its playback. */
const TURN_LOCK_NAME = "yui.turn";

const baseLog = createLogger("turn-gate");

export type TurnGate = ExclusiveHold;

export function createTurnGate(deps: {
  enabled: () => boolean;
  locks?: Pick<LockManager, "request">;
  logger?: Logger;
  now?: () => number;
}): TurnGate {
  const log = deps.logger ?? baseLog;
  const now = deps.now ?? Date.now;
  return createExclusiveHold({
    name: TURN_LOCK_NAME,
    enabled: deps.enabled,
    locks: deps.locks,
    reentrant: true,
    onWait() {
      log.info("turn_hold", {});
      const waitingSince = now();
      return () => log.info("turn_granted", { waited_ms: now() - waitingSince });
    },
  });
}
