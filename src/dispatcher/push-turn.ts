/**
 * push-turn — which push turns the user stopped.
 *
 * A render never interrupts speech, so a frame arriving after the user cut the reply has to be
 * dropped on its turn id instead. The user's action stops everything outstanding: the turn being
 * heard and any whose answer is still on its way. Ids are short strings, the set is per session.
 *
 * The same two events say when a turn stops running, so the call that sent it waits on them here.
 */

import { createLogger } from "../logger";

const log = createLogger("push-turn");

export interface PushTurns {
  /** The client sent this turn on the socket. */
  opened(turnId: string): void;
  /** A render of this turn was accepted for playback. */
  rendered(turnId: string | null): void;
  /** The user stopped the reply: everything outstanding is cut. */
  cut(): void;
  /** Whether a frame belongs to a cut turn. A null turn_id is never cut. */
  isCut(turnId: string | null): boolean;
  /** How many turns the user has stopped, for the line that reports a frame dropped on one. */
  cutCount(): number;
  /**
   * Resolves when a render of this turn is accepted, or when the turn is cut. One shot.
   * `onSettle` runs at that moment, before the frame's segments are read.
   */
  awaitFirstRender(turnId: string, onSettle?: () => void): Promise<"rendered" | "cut">;
  /** Stop waiting on this turn. The waiter is dropped unsettled, so `onSettle` never runs. */
  abandon(turnId: string): void;
}

export function createPushTurns(): PushTurns {
  const live = new Set<string>();
  const stopped = new Set<string>();
  const waiting = new Map<
    string,
    { resolve: (outcome: "rendered" | "cut") => void; onSettle?: () => void }
  >();

  function settle(turnId: string, outcome: "rendered" | "cut"): void {
    const waiter = waiting.get(turnId);
    if (!waiter) return;
    waiting.delete(turnId);
    // Resolve first: the continuation waits for a microtask, so the callback still runs before the
    // caller reads the frame, and a callback that throws cannot leave the turn unsettled.
    waiter.resolve(outcome);
    try {
      waiter.onSettle?.();
    } catch (err) {
      log.warn("settle_callback_failed", { turn_id: turnId, error: String(err) });
    }
  }

  return {
    opened(turnId) {
      live.add(turnId);
    },
    rendered(turnId) {
      if (turnId === null) return;
      live.add(turnId);
      settle(turnId, "rendered");
    },
    cut() {
      // Snapshot first: a settle callback may open a turn, and that one is outstanding after this
      // cut rather than part of it, so only the ids swept here leave the live set.
      for (const turnId of [...live]) {
        live.delete(turnId);
        stopped.add(turnId);
        settle(turnId, "cut");
      }
    },
    isCut(turnId) {
      return turnId !== null && stopped.has(turnId);
    },
    cutCount() {
      return stopped.size;
    },
    awaitFirstRender(turnId, onSettle) {
      return new Promise((resolve) => waiting.set(turnId, { resolve, onSettle }));
    },
    abandon(turnId) {
      waiting.delete(turnId);
    },
  };
}
