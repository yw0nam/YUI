/**
 * reasoning-bridge — the reasoning text seen from a window that does not own the push socket.
 *
 * One socket exists, in the pet window, and the reasoning deltas land in that window's store.
 * The popped-out message window runs in its own webview, so the pet window publishes the state
 * over the cross-window bridge and a freshly opened window asks for the current state at once.
 * The whole state crosses on every change, so a missed event cannot corrupt the text.
 */

import type { ReasoningState, ReasoningStore } from "./reasoning-store";
import type { SettingsBridge } from "./settings-bridge";

type ReasoningBridge = Pick<
  SettingsBridge,
  "emitReasoning" | "onReasoning" | "emitReasoningAsk" | "onReasoningAsk"
>;

/** The reasoning state as another window sees it — the shape the reasoning chip reads. */
export interface ReasoningMirror {
  get(): ReasoningState;
  subscribe(cb: (s: ReasoningState) => void): () => void;
  /** Ask the owner again — for a window that opened before anything arrived. */
  refresh(): void;
  dispose(): void;
}

/**
 * Owner side: publishes every state change and answers a newly opened window's ask with the
 * state as it stands. Returns its teardown.
 */
export function publishReasoning(deps: {
  store: Pick<ReasoningStore, "get" | "subscribe">;
  bridge: ReasoningBridge;
}): () => void {
  const unsubscribes = [
    deps.store.subscribe((state) => deps.bridge.emitReasoning(state)),
    deps.bridge.onReasoningAsk(() => deps.bridge.emitReasoning(deps.store.get())),
  ];
  return () => {
    for (const off of unsubscribes) off();
  };
}

/**
 * Reader side: mirrors the owner's state. It starts empty and asks at once, so a window opened
 * long after the pet window settled still shows where the reasoning stands.
 */
export function createMirroredReasoning(deps: { bridge: ReasoningBridge }): ReasoningMirror {
  const subscribers = new Set<(s: ReasoningState) => void>();
  let state: ReasoningState = { text: "", live: false };

  const off = deps.bridge.onReasoning((next) => {
    state = next;
    for (const cb of subscribers) cb(next);
  });
  deps.bridge.emitReasoningAsk();

  return {
    get: () => state,

    subscribe(cb): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    refresh(): void {
      deps.bridge.emitReasoningAsk();
    },

    dispose(): void {
      off();
      subscribers.clear();
    },
  };
}
