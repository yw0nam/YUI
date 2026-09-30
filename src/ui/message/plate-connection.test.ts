// @vitest-environment jsdom
/**
 * plate-connection.test.ts — the socket-state → plate-connection binding.
 */

import { describe, expect, it, vi } from "vitest";
import type { PushSocketState } from "../../io/chat/push-socket";
import { bindPlateConnection } from "./plate-connection";

function fakeSocket(initial: PushSocketState) {
  let state = initial;
  const subs = new Set<(s: PushSocketState) => void>();
  return {
    getState: () => state,
    onState(cb: (s: PushSocketState) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    set(next: PushSocketState) {
      state = next;
      for (const cb of subs) cb(next);
    },
    listenerCount: () => subs.size,
  };
}

describe("bindPlateConnection", () => {
  it("applies the state read before subscribing", () => {
    const socket = fakeSocket({ kind: "reconnecting", delay_ms: 4000 });
    const plate = { setConnection: vi.fn() };

    bindPlateConnection(plate, socket);

    expect(plate.setConnection).toHaveBeenCalledTimes(1);
    expect(plate.setConnection).toHaveBeenCalledWith("reconnecting");
    expect(socket.listenerCount()).toBe(1);
  });

  it("maps connecting and reconnecting to reconnecting, failed to failed, the rest to up", () => {
    const socket = fakeSocket({ kind: "disconnected" });
    const plate = { setConnection: vi.fn() };
    bindPlateConnection(plate, socket);

    socket.set({ kind: "connecting" });
    socket.set({ kind: "reconnecting", delay_ms: 1000 });
    socket.set({ kind: "failed", code: 4401 });
    socket.set({ kind: "ready", chat_id: "yui-3f9a2c1d" });
    socket.set({ kind: "disconnected" });

    expect(plate.setConnection.mock.calls).toEqual([
      ["up"],
      ["reconnecting"],
      ["reconnecting"],
      ["failed"],
      ["up"],
      ["up"],
    ]);
  });

  it("stops following the socket on dispose", () => {
    const socket = fakeSocket({ kind: "disconnected" });
    const plate = { setConnection: vi.fn() };
    const off = bindPlateConnection(plate, socket);

    off();
    socket.set({ kind: "connecting" });

    expect(plate.setConnection).toHaveBeenCalledTimes(1);
    expect(socket.listenerCount()).toBe(0);
  });
});
