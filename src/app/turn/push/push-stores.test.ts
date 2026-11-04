import { describe, expect, it, vi } from "vitest";
import type { ExpressVocabulary } from "../../../io/chat/vocabulary/express-vocabulary";

const { createPushSocket } = vi.hoisted(() => ({ createPushSocket: vi.fn() }));
vi.mock("../../../io/chat/push/push-socket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../io/chat/push/push-socket")>()),
  createPushSocket,
}));

import { createPetWindowTools } from "../../../io/chat/tools/pet-window-tools";
import { createRelationsStore } from "../../../settings/relations/relations-store";
import { noopScreenCapturer } from "../../../io/window/capture/screen-source-provider";
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

    stores.bind({ vocabulary: () => PAYLOAD, stopTurn: () => {}, windowTools: avatarTools });
    expect(socketDeps.tools()).toEqual(avatarTools.map((tool) => tool.definition));
  });

  it("declares the window subset without Terminal or Threads schemas", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    try {
      const tools = createPetWindowTools({
        bound: false, getExecutor: () => null,
        screen: { allowRequests: () => false, getWindow: () => null, listMonitors: async () => [], pointsAreLogical: true, capturer: noopScreenCapturer },
        relations: createRelationsStore(), relationsEnabled: () => false, targets: () => [], recordAddressed: vi.fn(),
        mcpHost: { snapshot: () => null, call: vi.fn(), cancel: vi.fn(), skill: vi.fn(), subscribe: vi.fn() },
        threads: { threads: () => [] },
      });
      const { stores, socketDeps } = createStores();
      stores.bind({ vocabulary: () => PAYLOAD, stopTurn: () => {}, windowTools: tools.declared });
      expect(socketDeps.tools().map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
        "rate_relation", "address_character", "body_action", "look", "yui_tool_describe", "yui_tool_call", "plugin_skill",
      ]);
    } finally { vi.unstubAllGlobals(); }
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
