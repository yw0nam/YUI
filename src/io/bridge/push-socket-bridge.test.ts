// @vitest-environment jsdom
/**
 * push-socket-bridge.test.ts — the push socket lives in the pet window, so the settings window
 * reads its state and asks for a reset over the cross-window bridge.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSocketState } from "../chat/push-socket";
import { createMirroredPushSocket, publishPushSocket } from "./push-socket-bridge";
import { type BridgeTransport, createSettingsBridge } from "./settings-bridge";

/** In-memory pub/sub shared by two bridges — one per window. */
function createFakeTransport(): BridgeTransport {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    emit(name, payload) {
      for (const cb of [...(listeners.get(name) ?? [])]) cb(payload);
    },
    listen(name, cb) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(cb);
      return () => set?.delete(cb);
    },
  };
}

function fakeSocket(initial: PushSocketState = { kind: "disconnected" }) {
  let state = initial;
  const subs = new Set<(s: PushSocketState) => void>();
  return {
    sendReset: vi.fn(() => true),
    reconnectNow: vi.fn(),
    getState: () => state,
    onState(cb: (s: PushSocketState) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    set(next: PushSocketState): void {
      state = next;
      for (const cb of subs) cb(next);
    },
    listenerCount: () => subs.size,
  };
}

let transport: BridgeTransport;
let petBridge: ReturnType<typeof createSettingsBridge>;
let settingsBridge: ReturnType<typeof createSettingsBridge>;
let socket: ReturnType<typeof fakeSocket>;
let stopTurn: ReturnType<typeof vi.fn<() => void>>;

function publish(): () => void {
  return publishPushSocket({ socket, stopTurn, bridge: petBridge });
}

beforeEach(() => {
  transport = createFakeTransport();
  petBridge = createSettingsBridge(transport, { windowKind: "pet" });
  settingsBridge = createSettingsBridge(transport, { windowKind: "settings" });
  socket = fakeSocket();
  stopTurn = vi.fn<() => void>();
});

describe("push socket across windows", () => {
  it("carries every state change from the pet window to the mirror", () => {
    publish();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    socket.set({ kind: "ready", chat_id: "yui-3f9a2c1d" });

    expect(mirror.getState()).toEqual({ kind: "ready", chat_id: "yui-3f9a2c1d" });
  });

  it("notifies the mirror's own subscribers", () => {
    publish();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });
    const seen: PushSocketState[] = [];
    mirror.onState((s) => seen.push(s));

    socket.set({ kind: "reconnecting", delay_ms: 2_000 });

    expect(seen).toEqual([{ kind: "reconnecting", delay_ms: 2_000 }]);
  });

  it("answers a mirror opened after the socket settled", () => {
    socket = fakeSocket({ kind: "ready", chat_id: "yui-0a1b2c3d" });
    publish();

    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    expect(mirror.getState()).toEqual({ kind: "ready", chat_id: "yui-0a1b2c3d" });
  });

  it("starts disconnected while no pet window answers", () => {
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });
    expect(mirror.getState()).toEqual({ kind: "disconnected" });
  });

  it("sends the mirror's reset request to the real socket", () => {
    publish();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    expect(mirror.sendReset()).toBe(true);
    expect(socket.sendReset).toHaveBeenCalledTimes(1);
  });

  it("stops the running turn before the mirror's reset reaches the socket", () => {
    const calls: string[] = [];
    stopTurn.mockImplementation(() => calls.push("stopTurn"));
    socket.sendReset.mockImplementation(() => {
      calls.push("sendReset");
      return true;
    });
    publish();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    mirror.sendReset();

    expect(calls).toEqual(["stopTurn", "sendReset"]);
  });

  it("does not reset the socket from its own window's publish", () => {
    publish();
    petBridge.emitPushReset();

    expect(socket.sendReset).not.toHaveBeenCalled();
  });

  it("sends the mirror's reconnect request to the real socket", () => {
    publish();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    mirror.reconnectNow();

    expect(socket.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect the socket from its own window's publish", () => {
    publish();
    petBridge.emitPushReconnect();

    expect(socket.reconnectNow).not.toHaveBeenCalled();
  });

  it("asks again on refresh, for a window that opened before the socket did", () => {
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });
    expect(mirror.getState()).toEqual({ kind: "disconnected" });

    socket = fakeSocket({ kind: "ready", chat_id: "yui-0a1b2c3d" });
    publish();
    mirror.refresh();

    expect(mirror.getState()).toEqual({ kind: "ready", chat_id: "yui-0a1b2c3d" });
  });

  it("stops publishing after the pet side is disposed", () => {
    publish()();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    socket.set({ kind: "ready", chat_id: "yui-3f9a2c1d" });

    expect(mirror.getState()).toEqual({ kind: "disconnected" });
    expect(socket.listenerCount()).toBe(0);
  });

  it("stops the reset path after the pet side is disposed", () => {
    publish()();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    mirror.sendReset();

    expect(socket.sendReset).not.toHaveBeenCalled();
  });

  it("stops the reconnect path after the pet side is disposed", () => {
    publish()();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });

    mirror.reconnectNow();

    expect(socket.reconnectNow).not.toHaveBeenCalled();
  });

  it("stops updating after the mirror is disposed", () => {
    publish();
    const mirror = createMirroredPushSocket({ bridge: settingsBridge });
    mirror.dispose();

    socket.set({ kind: "ready", chat_id: "yui-3f9a2c1d" });

    expect(mirror.getState()).toEqual({ kind: "disconnected" });
  });
});
