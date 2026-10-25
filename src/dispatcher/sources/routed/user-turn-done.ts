/**
 * user-turn-done — tells the unified chat window that this preset's turn for a send id is over.
 *
 * Wraps the dispatcher's close and drop hooks: a turn that closes, or that is dropped before it
 * speaks, reports done for the send id its envelope carried. A turn without one reports nothing.
 */

import type { UserTurnDone } from "../../../io/bridge/settings-bridge";
import { sendIdOf } from "../../core/classify";
import type { DispatcherDeps } from "../../dispatcher";

export function createUserTurnDone(deps: {
  presetId: () => string;
  emit: (event: UserTurnDone) => void;
  onTurnClosed: NonNullable<DispatcherDeps["onTurnClosed"]>;
  onTurnDropped: NonNullable<DispatcherDeps["onTurnDropped"]>;
}): {
  onTurnClosed: NonNullable<DispatcherDeps["onTurnClosed"]>;
  onTurnDropped: NonNullable<DispatcherDeps["onTurnDropped"]>;
} {
  const report = (sendId: string | undefined): void => {
    if (sendId) deps.emit({ sendId, preset: deps.presetId() });
  };
  return {
    onTurnClosed(turn) {
      deps.onTurnClosed(turn);
      report(turn.sendId);
    },
    onTurnDropped(env, reason) {
      deps.onTurnDropped(env, reason);
      report(sendIdOf(env));
    },
  };
}
