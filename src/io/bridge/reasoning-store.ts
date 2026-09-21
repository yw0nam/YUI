/**
 * reasoning-store — the backend's reasoning text as the current turn writes it.
 *
 * Deltas stream in while a cycle is live and the completed reply closes the cycle. Only the latest
 * cycle is kept: a delta after a finished cycle starts a new text. The text is never spoken
 * and never stored — the reasoning chip reads it.
 */

export interface ReasoningState {
  readonly text: string;
  readonly live: boolean;
}

export interface ReasoningStore {
  get(): ReasoningState;
  subscribe(cb: (s: ReasoningState) => void): () => void;
  /** A reasoning delta. After a finished cycle the first delta starts a new text. */
  append(delta: string): void;
  /** The reply landed: it closes the current live cycle, not necessarily the backend's whole run. */
  finish(full: string | undefined): void;
  /** The turn or connection owning the live cycle died: a finished text is kept. */
  interrupt(): void;
}

export function createReasoningStore(): ReasoningStore {
  const subscribers = new Set<(s: ReasoningState) => void>();
  let state: ReasoningState = { text: "", live: false };

  function set(next: ReasoningState): void {
    state = next;
    for (const cb of subscribers) cb(next);
  }

  return {
    get: () => state,

    subscribe(cb): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    append(delta) {
      if (delta === "") return;
      set({ text: state.live ? state.text + delta : delta, live: true });
    },

    finish(full) {
      const text = full !== undefined ? full : state.live ? state.text : "";
      set({ text, live: false });
    },

    interrupt() {
      if (!state.live) return;
      set({ text: "", live: false });
    },
  };
}
