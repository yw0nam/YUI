import { afterEach, expect, it, vi } from "vitest";
import { createConfiguredBootstrap } from "./bootstrap-configured";
import { wireTurnCore } from "./turn/turn-core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 0) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./stage/wire-bed-scene", () => ({
  wireBedScene: vi.fn<typeof import("./stage/wire-bed-scene").wireBedScene>(
    () => ({ takeMessageWake: () => false }) as never,
  ),
}));
vi.mock("./turn/turn-core", () => ({
  wireTurnCore: vi.fn<typeof import("./turn/turn-core").wireTurnCore>(),
}));
afterEach(() => vi.unstubAllGlobals());
it.each([
  [
    true,
    false,
    [
      "rate_relation",
      "address_character",
      "body_action",
      "look",
      "plugin_describe",
      "plugin_call",
      "plugin_skill",
    ],
  ],
  [
    true,
    true,
    ["rate_relation", "address_character", "plugin_describe", "plugin_call", "plugin_skill"],
  ],
  [false, false, ["rate_relation", "address_character"]],
])("a pet window (tauri: %s, bound: %s) declares %j", async (tauri, bound, names) => {
  vi.stubGlobal("__TAURI_INTERNALS__", tauri ? {} : undefined);
  vi.mocked(wireTurnCore).mockImplementation(async () => {
    throw Error("stop after tool composition");
  });
  const settings = {
    sttSettings: { get: () => ({ enabled: false }), setEnabled: () => {} },
    screenshotSettings: { get: () => ({ allowRequests: false }) },
  };
  await expect(
    createConfiguredBootstrap(
      {} as never,
      {
        bound,
        settings,
        conversation: { relationsStore: {} },
        vrm: { vrmSelection: {} },
        isDisposed: () => false,
      } as never,
    ),
  ).rejects.toThrow("stop after tool composition");
  const tools = vi.mocked(wireTurnCore).mock.calls[0]?.[2].windowTools ?? [];
  expect(tools.map((tool) => tool.name)).toEqual(names);
});
