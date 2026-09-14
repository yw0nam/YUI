/**
 * push-socket-bridge — the push socket seen from a window that does not own it.
 *
 * One socket exists, in the pet window. The settings window runs in its own webview, so it reads
 * the socket's state and asks for a reset over the same cross-window bridge the voice controls use.
 * A second socket is never opened: the conversation is one conversation.
 */

import { createLogger } from "../logger";
import type { PushSocketState } from "./push-socket";
import type { SettingsBridge } from "./settings-bridge";

const log = createLogger("push-socket-bridge");

type PushBridge = Pick<
  SettingsBridge,
  | "emitPushState"
  | "onPushState"
  | "emitPushStateAsk"
  | "onPushStateAsk"
  | "emitPushReset"
  | "onPushReset"
>;

/** The socket as another window sees it — the shape the settings panel's port needs. */
export interface PushSocketMirror {
  getState(): PushSocketState;
  onState(cb: (state: PushSocketState) => void): () => void;
  sendReset(): boolean;
  /** Ask the owner again — for a window that opened before the socket had anything to say. */
  refresh(): void;
  dispose(): void;
}

/**
 * Owner side: publishes every state change, answers a newly opened window's ask with the state as
 * it stands, and performs the reset another window requested. Returns its teardown.
 */
export function publishPushSocket(deps: {
  socket: {
    getState(): PushSocketState;
    onState(cb: (state: PushSocketState) => void): () => void;
    sendReset(): boolean;
  };
  bridge: PushBridge;
}): () => void {
  const unsubscribes = [
    deps.socket.onState((state) => deps.bridge.emitPushState(state)),
    deps.bridge.onPushStateAsk(() => deps.bridge.emitPushState(deps.socket.getState())),
    deps.bridge.onPushReset(() => {
      log.info("reset_requested");
      deps.socket.sendReset();
    }),
  ];
  return () => {
    for (const off of unsubscribes) off();
  };
}

/**
 * Reader side: mirrors the owner's state and forwards a reset request. It starts disconnected and
 * asks at once, so a window opened long after the socket settled still shows where it stands.
 */
export function createMirroredPushSocket(deps: { bridge: PushBridge }): PushSocketMirror {
  const subscribers = new Set<(state: PushSocketState) => void>();
  let state: PushSocketState = { kind: "disconnected" };

  const off = deps.bridge.onPushState((next) => {
    state = next;
    for (const cb of subscribers) cb(next);
  });
  deps.bridge.emitPushStateAsk();

  return {
    getState: () => state,

    onState(cb): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    // The owner window performs it; a request that reaches no owner changes nothing.
    sendReset(): boolean {
      deps.bridge.emitPushReset();
      return true;
    },

    refresh(): void {
      deps.bridge.emitPushStateAsk();
    },

    dispose(): void {
      off();
      subscribers.clear();
    },
  };
}
