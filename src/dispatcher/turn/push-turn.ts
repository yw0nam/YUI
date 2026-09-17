/**
 * push-turn — which push turns the user stopped.
 *
 * A render never interrupts speech, so a frame arriving after the user cut the reply has to be
 * dropped on its turn id instead. The user's action stops everything outstanding: the turn being
 * heard and any whose answer is still on its way. Ids are short strings, the set is per session.
 *
 * The same events say when a turn stops running, so the call that sent it waits here: a render of
 * the turn keeps the wait alive and carries the hooks, and the turn's `turn_end` or a cut settles
 * it.
 */

import { createLogger } from "../../logger";

const log = createLogger("push-turn");

/** Hooks a wait on a turn runs as its frames arrive. */
export interface TurnEndHooks {
  /** The turn's first render was accepted — the thinking bridge comes down here. */
  onFirstRender?: () => void;
  /** A frame of the turn arrived — the frame wait restarts on it. */
  onFrame?: () => void;
}

export interface PushTurns {
  /** The client sent this turn on the socket. */
  opened(turnId: string): void;
  /** A render of this turn was accepted for playback. */
  rendered(turnId: string): void;
  /** The user stopped the reply: everything outstanding is cut. */
  cut(): void;
  /** Whether a frame belongs to a cut turn. */
  isCut(turnId: string): boolean;
  /** How many stopped turns are still waiting for their turn_end, for the line that reports a
   *  frame dropped on one. */
  cutCount(): number;
  /** The backend closed the turn: it is forgotten — no longer live, no longer cut. */
  ended(turnId: string): void;
  /**
   * Resolves when the turn ends or is cut; its renders keep the wait open. One shot.
   * `onFrame` runs on every frame of the turn, `onFirstRender` only on the first one, both
   * before the frame's segments are read.
   */
  awaitTurnEnd(turnId: string, hooks?: TurnEndHooks): Promise<"ended" | "cut">;
  /** Stop waiting on this turn. The waiter is dropped unsettled, so the hooks never run. */
  abandon(turnId: string): void;
}

interface Waiter {
  resolve: (outcome: "ended" | "cut") => void;
  hooks: TurnEndHooks;
  rendered: boolean;
}

export function createPushTurns(): PushTurns {
  const live = new Set<string>();
  const stopped = new Set<string>();
  const waiting = new Map<string, Waiter>();

  function runHook(turnId: string, hook: (() => void) | undefined): void {
    if (!hook) return;
    try {
      hook();
    } catch (err) {
      log.warn("turn_hook_failed", { turn_id: turnId, error: String(err) });
    }
  }

  /** Takes the waiter out and resolves it; the continuation waits for a microtask. */
  function settle(turnId: string, outcome: "ended" | "cut"): void {
    const waiter = waiting.get(turnId);
    if (!waiter) return;
    waiting.delete(turnId);
    waiter.resolve(outcome);
  }

  return {
    opened(turnId) {
      live.add(turnId);
    },
    rendered(turnId) {
      live.add(turnId);
      const waiter = waiting.get(turnId);
      if (!waiter) return;
      runHook(turnId, waiter.hooks.onFrame);
      if (!waiter.rendered) {
        waiter.rendered = true;
        runHook(turnId, waiter.hooks.onFirstRender);
      }
    },
    cut() {
      // Snapshot first: the swept turns leave the live set, and nothing a resolution schedules
      // runs inside this loop.
      for (const turnId of [...live]) {
        live.delete(turnId);
        stopped.add(turnId);
        settle(turnId, "cut");
      }
    },
    isCut(turnId) {
      return stopped.has(turnId);
    },
    cutCount() {
      return stopped.size;
    },
    ended(turnId) {
      live.delete(turnId);
      stopped.delete(turnId);
      const waiter = waiting.get(turnId);
      if (!waiter) return;
      runHook(turnId, waiter.hooks.onFrame);
      settle(turnId, "ended");
    },
    awaitTurnEnd(turnId, hooks = {}) {
      return new Promise((resolve) => waiting.set(turnId, { resolve, hooks, rendered: false }));
    },
    abandon(turnId) {
      waiting.delete(turnId);
    },
  };
}
