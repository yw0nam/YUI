/**
 * push-turn — which push turns the user stopped.
 *
 * A render never interrupts speech, so a frame arriving after the user cut the reply has to be
 * dropped on its turn id instead. The user's action stops everything outstanding: the turn being
 * heard and any whose answer is still on its way. Ids are short strings, the set is per session.
 *
 * The same two events say when a turn stops running, so the call that sent it waits on them here.
 */

export interface PushTurns {
  /** The client sent this turn on the socket. */
  opened(turnId: string): void;
  /** A render of this turn was accepted for playback. */
  rendered(turnId: string | null): void;
  /** The user stopped the reply: everything outstanding is cut. */
  cut(): void;
  /** Whether a frame belongs to a cut turn. A null turn_id is never cut. */
  isCut(turnId: string | null): boolean;
  /** Resolves when a render of this turn is accepted, or when the turn is cut. One shot. */
  awaitFirstRender(turnId: string): Promise<"rendered" | "cut">;
}

export function createPushTurns(): PushTurns {
  const live = new Set<string>();
  const stopped = new Set<string>();
  const waiting = new Map<string, (outcome: "rendered" | "cut") => void>();

  function settle(turnId: string, outcome: "rendered" | "cut"): void {
    const resolve = waiting.get(turnId);
    if (!resolve) return;
    waiting.delete(turnId);
    resolve(outcome);
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
      for (const turnId of live) {
        stopped.add(turnId);
        settle(turnId, "cut");
      }
      live.clear();
    },
    isCut(turnId) {
      return turnId !== null && stopped.has(turnId);
    },
    awaitFirstRender(turnId) {
      if (stopped.has(turnId)) return Promise.resolve("cut");
      return new Promise((resolve) => waiting.set(turnId, resolve));
    },
  };
}
