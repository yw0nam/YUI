import { describe, expect, it, vi } from "vitest";
import builtinNames from "../../../contract/builtin-client-tools.json";
import { createRelationsStore } from "../../../settings/relations/relations-store";
import { noopScreenCapturer } from "../../window/capture/screen-source-provider";
import { createGenerateExpressTool } from "./express";
import { createPetWindowTools } from "./pet-window-tools";
import { helpText } from "./run/help";
import { stubYuiRunPorts } from "./run/yui-run-test-ports";

vi.mock("../../../tauri-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../tauri-env")>()),
  isTauri: () => true,
}));

function windowTools(bound = false, relationsEnabled = false) {
  return createPetWindowTools({
    bound,
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
    threads: bound ? null : { threads: () => [] },
    run: {
      ...stubYuiRunPorts(),
      help: (declarations) => helpText((key) => key, [], declarations),
    },
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

  it.each([true, false])("keeps the declared names across Relations state %s", (enabled) => {
    expect(windowTools(false, enabled).map((tool) => tool.name)).toEqual([
      "rate_relation",
      "address_character",
      "body_action",
      "yui_run",
    ]);
    expect(windowTools(true, enabled).map((tool) => tool.name)).toEqual([
      "rate_relation",
      "address_character",
      "yui_run",
    ]);
  });

  it("gives the main window the look and threads blocks in help() and a bound window neither", async () => {
    const helpOf = async (bound: boolean) => {
      const yuiRun = windowTools(bound).find((tool) => tool.name === "yui_run")!;
      const run = await yuiRun.execute({ code: "return await help()" });
      return JSON.parse(run as string).result as string;
    };
    const main = await helpOf(false);
    expect(main).toContain("perch_targets()");
    expect(main).toContain("search(query: string)");
    const bound = await helpOf(true);
    expect(bound).not.toContain("perch_targets()");
    expect(bound).not.toContain("search(query: string)");
    expect(bound).toContain("  terminal: {");
  });
});
