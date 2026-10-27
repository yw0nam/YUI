/** Delivery of the unified chat window's sends: one at a time, one target at a time. */

import type { UserTurnDone, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import type { Send } from "./targets";

const log = createLogger("sequence");

/** How long a target may stay silent before the sequence moves on, and how long a sent line waits for its record. */
export const SEND_TIMEOUT_MS = 60_000;

/** A done for the current send and target, or SEND_TIMEOUT_MS, moves on; a send that arrives meanwhile queues. */
// ponytail: one queue, one timeout; no per-target retry while the backend answers nearly every turn
export function createSequence(deps: {
  emit: (event: UserTurnRouted) => void;
  /** A queued send reached the front and is about to be emitted. */
  onStart?: (sendId: string) => void;
  /** The last send is over and nothing waits. */
  onIdle?: () => void;
}): {
  run(send: Send): void;
  turnDone(done: UserTurnDone): void;
  /** Whether a send is under way. */
  running(): boolean;
  /** Drops the send under way and every queued one. */
  cancel(): void;
  dispose(): void;
} {
  const queue: Send[] = [];
  let current: { send: Send; index: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function emitCurrent(): void {
    const { send, index } = current!;
    const to = send.targets[index]!;
    deps.emit({
      sendId: send.sendId,
      to,
      text: send.text,
      ...(send.mention ? { mention: send.mention } : {}),
      ...(send.via ? { via: send.via } : {}),
    });
    timer = setTimeout(() => {
      log.info("sequence_timeout", { preset: to });
      advance();
    }, SEND_TIMEOUT_MS);
  }

  function startNext(): void {
    const send = queue.shift();
    if (!send) {
      current = null;
      deps.onIdle?.();
      return;
    }
    current = { send, index: 0 };
    deps.onStart?.(send.sendId);
    emitCurrent();
  }

  function cancel(): void {
    clearTimeout(timer);
    queue.length = 0;
    current = null;
  }

  function advance(): void {
    clearTimeout(timer);
    if (!current) return;
    current.index++;
    if (current.index < current.send.targets.length) emitCurrent();
    else startNext();
  }

  return {
    run(send) {
      queue.push(send);
      if (!current) startNext();
    },
    turnDone({ sendId, preset }) {
      if (current?.send.sendId === sendId && current.send.targets[current.index] === preset)
        advance();
    },
    running: () => current !== null,
    cancel,
    dispose: cancel,
  };
}
