/** Each pet window owns one socket; its companions mirror reasoning over preset-scoped channels. */

import { createStateMirror, publishState } from "../core/state-mirror";
import type { SettingsBridge } from "../settings-bridge";
import type { ReasoningState, ReasoningStore } from "./reasoning-store";

type ReasoningBridge = Pick<
  SettingsBridge,
  "emitReasoning" | "onReasoning" | "emitReasoningAsk" | "onReasoningAsk"
>;

/** The reasoning state as another window sees it — the shape the bubble's reasoning disclosure reads. */
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
  return publishState({
    get: deps.store.get,
    subscribe: deps.store.subscribe,
    emit: deps.bridge.emitReasoning,
    onAsk: deps.bridge.onReasoningAsk,
  });
}

/**
 * Reader side: mirrors the owner's state. It starts empty and asks at once, so a window opened
 * long after the pet window settled still shows where the reasoning stands.
 */
export function createMirroredReasoning(deps: { bridge: ReasoningBridge }): ReasoningMirror {
  return createStateMirror<ReasoningState>({
    initial: { text: "", live: false },
    on: deps.bridge.onReasoning,
    ask: deps.bridge.emitReasoningAsk,
  });
}
