import { describe, expect, it, vi } from "vitest";
import type { ExpressVocabulary } from "../../../io/chat/vocabulary/express-vocabulary";

const { createPushSocket } = vi.hoisted(() => ({ createPushSocket: vi.fn() }));
vi.mock("../../../io/chat/push/push-socket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../io/chat/push/push-socket")>()),
  createPushSocket,
}));

import { createAvatarTools } from "../../../io/chat/tools/avatar";
import { createPushStores } from "./push-stores";

describe("createPushStores", () => {
  const PAYLOAD: ExpressVocabulary = {
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

  it("declares no tools until bind, then the schemas of the bound avatar tools", () => {
    const { stores, socketDeps } = createStores();
    const avatarTools = createAvatarTools(() => null);

    expect(socketDeps.tools()).toEqual([]);

    stores.bind({ vocabulary: () => PAYLOAD, stopTurn: () => {}, avatarTools });
    expect(socketDeps.tools()).toEqual(avatarTools.map((tool) => tool.definition));
  });

  it("declares no tools when bound with none", () => {
    const { stores, socketDeps } = createStores();

    stores.bind({ vocabulary: () => PAYLOAD, stopTurn: () => {} });
    expect(socketDeps.tools()).toEqual([]);
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
