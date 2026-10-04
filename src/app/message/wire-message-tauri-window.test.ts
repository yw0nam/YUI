// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  setFocus: vi.fn(),
  startDragging: vi.fn(),
  onMoved: vi.fn(),
  unlistenMoved: vi.fn(),
}));

vi.mock("../../tauri-env", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
  availableMonitors: async () => [],
}));
vi.mock("@tauri-apps/api/dpi", () => ({ LogicalSize: class {}, PhysicalPosition: class {} }));
vi.mock("../../io/window/geometry/keep-on-screen", () => ({
  attachKeepOnScreen: async () => ({ dispose: vi.fn() }),
}));

import { focusWindow, startDragging, wireTauriWindow } from "./wire-message-tauri-window";

beforeEach(() => {
  vi.clearAllMocks();
  win.onMoved.mockResolvedValue(win.unlistenMoved);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

it("focuses and drags the current window, and swallows a failure", async () => {
  await focusWindow();
  await startDragging();
  expect(win.setFocus).toHaveBeenCalledOnce();
  expect(win.startDragging).toHaveBeenCalledOnce();

  win.setFocus.mockRejectedValueOnce(new Error("denied"));
  await expect(focusWindow()).resolves.toBeUndefined();
});

it("records the window's moved position and unlistens on dispose", async () => {
  const setPosition = vi.fn();
  const dispose = await wireTauriWindow(document.createElement("div"), { setPosition });

  win.onMoved.mock.calls[0]![0]({ payload: { x: 10, y: 20 } });
  expect(setPosition).toHaveBeenCalledWith(10, 20);

  dispose();
  expect(win.unlistenMoved).toHaveBeenCalledOnce();
});
