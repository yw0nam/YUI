import { afterEach, expect, it, vi } from "vitest";
import { createFlagSettings } from "../settings/persisted-store";
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
  [false, ["rate_relation", "body_action", "look", "browser"]],
  [true, ["rate_relation", "browser"]],
])("a pet window (bound: %s) declares %j", async (bound, names) => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.mocked(wireTurnCore).mockImplementation(async () => {
    throw Error("stop after tool composition");
  });
  const browserSettings = createFlagSettings(false);
  try {
    await expect(
      createConfiguredBootstrap(
        {} as never,
        {
          bound,
          settings: {
            browserSettings,
            sttSettings: { get: () => ({ enabled: false }), setEnabled: () => {} },
            screenshotSettings: { get: () => ({ allowRequests: false }) },
          },
          conversation: { relationsStore: {} },
          vrm: { vrmSelection: {} },
          isDisposed: () => false,
        } as never,
      ),
    ).rejects.toThrow("stop after tool composition");
    const tools = vi.mocked(wireTurnCore).mock.calls[0]?.[2].windowTools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual(names);
  } finally {
    browserSettings.dispose();
  }
});
