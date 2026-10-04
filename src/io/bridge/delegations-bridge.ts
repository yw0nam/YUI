/**
 * delegations-bridge — the delegations list seen from a window that does not own the push socket.
 *
 * One socket exists, in the pet window, and its `delegations` frames land in that window's store.
 * The settings window runs in its own webview, so the pet window publishes the list over the
 * cross-window bridge and a freshly opened settings window asks for the current list at once.
 * A second socket is never opened: the conversation is one conversation.
 */

import type { DelegationItem } from "../chat/push-socket";
import { createStateMirror, publishState } from "./core/state-mirror";
import type { SettingsBridge } from "./settings-bridge";

type DelegationsBridge = Pick<
  SettingsBridge,
  "emitDelegations" | "onDelegations" | "emitDelegationsAsk" | "onDelegationsAsk"
>;

/** The delegations list as another window sees it — the shape the settings panel's section needs. */
export interface DelegationsMirror {
  get(): DelegationItem[];
  runningCount(): number;
  subscribe(cb: (items: DelegationItem[]) => void): () => void;
  /** Ask the owner again — for a window that opened before the list had anything on it. */
  refresh(): void;
  dispose(): void;
}

/**
 * Owner side: publishes every list change and answers a newly opened window's ask with the list as
 * it stands. Returns its teardown.
 */
export function publishDelegations(deps: {
  store: {
    get(): DelegationItem[];
    subscribe(cb: (items: DelegationItem[]) => void): () => void;
  };
  bridge: DelegationsBridge;
}): () => void {
  return publishState({
    get: deps.store.get,
    subscribe: deps.store.subscribe,
    emit: deps.bridge.emitDelegations,
    onAsk: deps.bridge.onDelegationsAsk,
  });
}

/**
 * Reader side: mirrors the owner's list. It starts empty and asks at once, so a window opened long
 * after the pet window settled still shows where the work stands.
 */
export function createMirroredDelegations(deps: { bridge: DelegationsBridge }): DelegationsMirror {
  const mirror = createStateMirror<DelegationItem[]>({
    initial: [],
    on: deps.bridge.onDelegations,
    ask: deps.bridge.emitDelegationsAsk,
  });

  return {
    ...mirror,
    runningCount: () => mirror.get().filter((item) => item.state === "running").length,
  };
}
