import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, it, vi } from "vitest";
import { createFlagSettings } from "../settings/persisted-store";
import { createConfiguredBootstrap } from "./bootstrap-configured";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 0) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./stage/wire-bed-scene", () => ({
  wireBedScene: vi.fn<typeof import("./stage/wire-bed-scene").wireBedScene>(
    () => ({ takeMessageWake: () => false }) as never,
  ),
}));
vi.mock("./turn/turn-core", () => ({
  wireTurnCore: vi.fn<typeof import("./turn/turn-core").wireTurnCore>(async () => {
    throw Error("stop after tool composition");
  }),
}));
afterEach(() => vi.unstubAllGlobals());
it.each([
  false,
  true,
])("only main initializes the shared browser shell (bound: %s)", async (bound) => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
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
          vrm: { vrmSelection: {} },
          isDisposed: () => false,
        } as never,
      ),
    ).rejects.toThrow("stop after tool composition");
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "browser_generation")).toEqual(
      bound ? [] : [["browser_generation"]],
    );
  } finally {
    browserSettings.dispose();
  }
});
