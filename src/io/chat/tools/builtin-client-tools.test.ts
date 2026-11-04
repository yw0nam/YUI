import { describe, expect, it, vi } from "vitest";
import builtinNames from "../../../contract/builtin-client-tools.json";
import { createRelationsStore } from "../../../settings/relations/relations-store";
import { noopScreenCapturer } from "../../window/capture/screen-source-provider";
import { createGenerateExpressTool } from "./express";
import { createPetWindowTools } from "./pet-window-tools";

vi.mock("../../../tauri-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../tauri-env")>()),
  isTauri: () => true,
}));

function windowTools(relationsEnabled = false) {
  return createPetWindowTools({
    bound: false,
    getExecutor: () => null,
    screen: {
      allowRequests: () => false,
      getWindow: () => null,
      listMonitors: async () => [],
      pointsAreLogical: true,
      capturer: noopScreenCapturer,
    },
    relations: createRelationsStore(),
    relationsEnabled: () => relationsEnabled,
    targets: () => [],
    recordAddressed: vi.fn(),
    mcpHost: {
      snapshot: () => null,
      call: vi.fn(),
      cancel: vi.fn(),
      skill: vi.fn(),
      subscribe: vi.fn(),
    },
    threads: { threads: () => [] },
  });
}

describe("builtin-client-tools.json", () => {
  it("lists every client tool a main pet window declares under Tauri", () => {
    const tools = windowTools();
    const express = createGenerateExpressTool({
      emotionIds: [],
      motionIds: [],
      emotionText: { mode: "free", table: null },
    });

    expect([...tools.declared, ...tools.onDemand, express].map((tool) => tool.name).sort()).toEqual(
      builtinNames,
    );
  });

  it.each([
    true,
    false,
  ])("keeps the declared set and definitions across Relations state %s", (enabled) => {
    const tools = windowTools(enabled);
    expect(tools.declared.map((tool) => tool.name)).toEqual([
      "rate_relation",
      "address_character",
      "body_action",
      "look",
      "yui_tool_describe",
      "yui_tool_call",
      "plugin_skill",
    ]);
    expect(tools.declared.map((tool) => tool.definition)).toEqual(
      windowTools(!enabled).declared.map((tool) => tool.definition),
    );
    expect(tools.onDemand.map((tool) => tool.name)).toEqual([
      "threads_list",
      "threads_search",
      "terminal_open",
      "terminal_list",
      "terminal_read",
      "terminal_write",
      "terminal_close",
    ]);
  });
});
