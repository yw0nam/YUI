/**
 * push-turn — which push turns the user stopped.
 *
 * A render never interrupts speech, so a frame arriving after the user cut the reply has to be
 * dropped on its turn id instead. The user's action stops everything outstanding: the turn being
 * heard and any whose answer is still on its way. Ids are short strings, the set is per session.
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
}

export function createPushTurns(): PushTurns {
  const live = new Set<string>();
  const stopped = new Set<string>();

  return {
    opened(turnId) {
      live.add(turnId);
    },
    rendered(turnId) {
      if (turnId !== null) live.add(turnId);
    },
    cut() {
      for (const turnId of live) stopped.add(turnId);
      live.clear();
    },
    isCut(turnId) {
      return turnId !== null && stopped.has(turnId);
    },
  };
}
