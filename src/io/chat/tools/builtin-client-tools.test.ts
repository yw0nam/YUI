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

const TERMINAL_TOOLS = [
  "terminal_open",
  "terminal_list",
  "terminal_read",
  "terminal_write",
  "terminal_close",
];

function windowTools() {
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
    relationsEnabled: () => false,
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

    expect([...tools, express].map((tool) => tool.name).sort()).toEqual(builtinNames);
  });

  it("declares the five terminal tools in every pet window under Tauri", () => {
    const names = windowTools().map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining(TERMINAL_TOOLS));
  });
});
