import { describe, expect, it, vi } from "vitest";
import type { BrokerPayload } from "../../io/chat/broker/broker-client";

const { createPushSocket } = vi.hoisted(() => ({ createPushSocket: vi.fn() }));
vi.mock("../../io/chat/push/push-socket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../io/chat/push/push-socket")>()),
  createPushSocket,
}));

import { createPushStores } from "./push-stores";

describe("createPushStores", () => {
  const PAYLOAD: BrokerPayload = {
    emotionIds: ["happy"],
    motionIds: ["wave"],
    emotionText: { mode: "enum", table: { happy: "joy" } },
  };

  function createStores() {
    createPushSocket.mockReset();
    createPushSocket.mockImplementation(() => ({ dispose: vi.fn() }));
    const register = vi.fn();
    const stores = createPushStores({
      getEndpoints: () => ({ chat_base_url: "http://localhost:8646" }),
      getChatKey: async () => undefined,
      register,
    });
    return { stores, register, socketDeps: createPushSocket.mock.calls[0][0] };
  }

  it("serves an empty vocabulary until bind, then the bound one", () => {
    const { stores, socketDeps } = createStores();

    expect(socketDeps.vocabulary()).toEqual({
      emotion_ids: [],
      motion_ids: [],
      emotion_text_mode: "free",
      emotion_text_map: {},
    });

    stores.bind({ vocabulary: () => PAYLOAD, stopTurn: () => {} });
    expect(socketDeps.vocabulary()).toEqual({
      emotion_ids: ["happy"],
      motion_ids: ["wave"],
      emotion_text_mode: "enum",
      emotion_text_map: { happy: "joy" },
    });
  });

  it("stops the bound turn only once the stop is bound, with no bridge", () => {
    const { stores } = createStores();
    const stop = vi.fn();

    expect(() => stores.stopTurn()).not.toThrow();
    expect(stop).not.toHaveBeenCalled();

    stores.bind({ vocabulary: () => PAYLOAD, stopTurn: stop });
    stores.stopTurn();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("registers the socket, the chat id, and the history", () => {
    const { register } = createStores();

    expect(register).toHaveBeenCalledTimes(3);
  });
});
