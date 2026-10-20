// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { WebviewWindow, getByLabel } = vi.hoisted(() => ({
  WebviewWindow: vi.fn(
    class {
      once = vi.fn();
    },
  ),
  getByLabel: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Object.assign(WebviewWindow, { getByLabel }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    outerPosition: async () => ({ x: 1, y: 2 }),
    outerSize: async () => ({ width: 400, height: 600 }),
    scaleFactor: async () => 1,
  }),
  availableMonitors: async () => [],
}));

import { createMessageWindowController } from "./message-window";

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  getByLabel.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());
it.each([null, "a"])("targets and reuses companion (bound: %s)", async (id) => {
  const store = { get: () => ({ mode: "popped" as const, x: null, y: null }), setMode: vi.fn() };
  const controller = createMessageWindowController(store, id);
  controller.open();
  await vi.waitFor(() =>
    expect(WebviewWindow).toHaveBeenCalledWith(
      id ? "message-a" : "message",
      expect.objectContaining({ url: id ? "message.html?preset=a" : "message.html" }),
    ),
  );
  const show = vi.fn(async () => {}),
    hide = vi.fn(async () => {});
  getByLabel.mockResolvedValue({ show, hide });
  controller.open();
  controller.hide();
  await vi.waitFor(() => expect(hide).toHaveBeenCalledTimes(1));
  expect(show).toHaveBeenCalledTimes(1);
  expect(getByLabel).toHaveBeenLastCalledWith(id ? "message-a" : "message");
});
