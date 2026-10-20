// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getByLabel, destroyed, selfClose } = vi.hoisted(() => ({
  getByLabel: vi.fn(),
  destroyed: vi.fn(),
  selfClose: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel } }));
const native = vi.hoisted(() => ({ listen: vi.fn(), destroy: vi.fn(), off: vi.fn() }));
vi.mock("@tauri-apps/api/window", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/window")>();
  return {
    ...actual,
    getCurrentWindow: () => ({
      ...native,
      onCloseRequested: actual.Window.prototype.onCloseRequested,
    }),
  };
});

import { createLogger } from "../../logger";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { wireCompanionWindow } from "./companion-window";

beforeEach(() => {
  localStorage.clear();
  native.listen.mockResolvedValue(native.off);
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  getByLabel.mockImplementation(async () => ({ once: destroyed }));
  destroyed.mockImplementation(async () => () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
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

it("tears down and clears its live key before the native close request destroys the webview", async () => {
  const calls: string[] = [];
  const role = await wireCompanionWindow({
    label: "settings-a",
    boundId: "a",
    registry: { get: () => ({ active: "default", list: [{ id: "a", name: "A" }] }) },
    disposeWindow: () => {
      expect(localStorage.getItem("yui.live-window.settings-a")).toBe("1");
      calls.push("stores");
    },
    close: selfClose,
    log: createLogger("test"),
  });
  expect(role.alive).toBe(true);
  expect(native.listen).toHaveBeenCalledWith("tauri://close-requested", expect.any(Function));
  native.destroy.mockImplementation(async () => {
    expect(localStorage.getItem("yui.live-window.settings-a")).toBeNull();
    calls.push("destroy");
  });
  await native.listen.mock.calls[0]![1]({ id: 1, event: "tauri://close-requested", payload: null });
  expect(calls).toEqual(["stores", "destroy"]);
  expect(native.off).toHaveBeenCalledTimes(1);
});
it("closes an unlisted preset before creating a live key or observing its owner", async () => {
  const disposeWindow = vi.fn();
  const role = await wireCompanionWindow({
    label: "settings-missing",
    boundId: "missing",
    registry: { get: () => ({ active: "default", list: [] }) },
    disposeWindow,
    close: selfClose,
    log: createLogger("test"),
  });
  expect(role.alive).toBe(false);
  expect(selfClose).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
  expect(getByLabel).not.toHaveBeenCalled();
});
