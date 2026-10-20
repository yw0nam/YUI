// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getByLabel, destroyed, selfClose } = vi.hoisted(() => ({
  getByLabel: vi.fn(),
  destroyed: vi.fn(),
  selfClose: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel } }));

import { createLogger } from "../../logger";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { wireCompanionWindow } from "./companion-window";
import { watchOwner } from "./companion-windows";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  getByLabel.mockImplementation(async () => ({ once: destroyed }));
  destroyed.mockImplementation(async () => () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it.each([false, true])("closes when owner is absent or destroyed (exists: %s)", async (exists) => {
  if (!exists) getByLabel.mockResolvedValue(null);
  const watcher = await watchOwner("a", selfClose);
  if (exists) destroyed.mock.calls[0]![1]();
  expect(selfClose).toHaveBeenCalledTimes(1);
  expect(watcher.alive).toBe(false);
  watcher.dispose();
});
it("holds its own guard through store teardown, then clears before close", async () => {
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({
      active: "default",
      list: [
        { id: "default", name: "Default" },
        { id: "a", name: "A" },
      ],
    }),
  );
  const registry = createPresetRegistry();
  const calls: string[] = [];
  const lifecycle = await wireCompanionWindow({
    label: "settings-a",
    boundId: "a",
    registry,
    disposeWindow: () => {
      expect(localStorage.getItem("yui.live-window.settings-a")).toBe("1");
      calls.push("stores");
    },
    close: () => {
      expect(localStorage.getItem("yui.live-window.settings-a")).toBeNull();
      calls.push("close");
    },
    log: createLogger("test"),
  });
  expect(lifecycle.alive).toBe(true);
  expect(registry.remove("a")).toBe(false);
  expect(registry.activate("a")).toBe(false);
  await lifecycle.close();
  expect(calls).toEqual(["stores", "close"]);
  expect(registry.remove("a")).toBe(true);
});
