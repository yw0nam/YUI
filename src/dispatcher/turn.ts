/**
 * Turn — owns turn identity and the single definition of "over".
 *
 * A ledger, not an authority: it records begin/settle/audio-owed and answers
 * isOver(); it drives nothing.
 */

import type { BusEnvelope } from "./event-bus";

export interface Turn {
  readonly id: number;
  readonly trigger: BusEnvelope;
  readonly startedAt: number;
}

export interface TurnLog {
  /** Dispatcher admits a trigger for a backend round trip. Retires any previous turn. */
  begin(trigger: BusEnvelope): Turn;
  /** Dispatcher reports the call half finished. Ignored when `id` is not the current turn. */
  settle(id: number): void;
  /** speech-playback reports whether audio is still owed. Always describes the current turn. */
  setAudioOwed(owed: boolean): void;
  /** The most recent turn, settled or not. Null only before the first `begin`. */
  current(): Turn | null;
  /** Audio is queued or playing. */
  isAudioOwed(): boolean;
  /** THE definition of over: settled AND no audio owed. True before the first turn. */
  isOver(): boolean;
  /** Fires only at the over⟷live boundary. Returns an unsubscribe fn. */
  subscribe(cb: (over: boolean) => void): () => void;
}

export function createTurnLog(): TurnLog {
  let current: Turn | null = null;
  let settled = false;
  let audioOwed = false;
  let nextId = 1;
  const subscribers = new Set<(over: boolean) => void>();

  function isOver(): boolean {
    return current === null || (settled && !audioOwed);
  }

  /** Single path for state mutation: caller mutates first, then calls this to notify on a flip. */
  function notifyIfFlipped(wasOver: boolean): void {
    const isOverNow = isOver();
    if (isOverNow === wasOver) return;
    for (const cb of subscribers) cb(isOverNow);
  }

  return {
    begin(trigger) {
      const wasOver = isOver();
      const turn: Turn = { id: nextId++, trigger, startedAt: Date.now() };
      current = turn;
      settled = false;
      audioOwed = false;
      notifyIfFlipped(wasOver);
      return turn;
    },
    settle(id) {
      if (current?.id !== id) return;
      const wasOver = isOver();
      settled = true;
      notifyIfFlipped(wasOver);
    },
    setAudioOwed(owed) {
      if (current === null) return;
      const wasOver = isOver();
      audioOwed = owed;
      notifyIfFlipped(wasOver);
    },
    current() {
      return current;
    },
    isAudioOwed() {
      return audioOwed;
    },
    isOver,
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
  };
}
