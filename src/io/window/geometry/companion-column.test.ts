// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  setFocus: vi.fn(),
  startDragging: vi.fn(),
  onMoved: vi.fn(),
  unlistenMoved: vi.fn(),
}));
const warn = vi.hoisted(() => vi.fn());

vi.mock("../../../logger", () => ({ createLogger: () => ({ warn }) }));

vi.mock("../../../tauri-env", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
  availableMonitors: async () => [],
}));
vi.mock("@tauri-apps/api/dpi", () => ({ LogicalSize: class {}, PhysicalPosition: class {} }));
vi.mock("./keep-on-screen", () => ({
  attachKeepOnScreen: async () => ({ dispose: vi.fn() }),
}));

import { focusWindow, startDragging, wireCompanionColumn } from "./companion-column";

beforeEach(() => {
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
  await focusWindow("unified");
  await startDragging("unified");
  expect(win.setFocus).toHaveBeenCalledOnce();
  expect(win.startDragging).toHaveBeenCalledOnce();

  win.setFocus.mockRejectedValueOnce(new Error("denied"));
  await expect(focusWindow("unified")).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith("focus_failed", { window: "unified", error: "Error: denied" });
});

it.each([
  false,
  true,
])("records position only while its owning window is active (disposed: %s)", async (disposed) => {
  const setPosition = vi.fn();
  const dispose = await wireCompanionColumn(
    "message",
    document.createElement("div"),
    setPosition,
    () => disposed,
  );

  win.onMoved.mock.calls[0]![0]({ payload: { x: 10, y: 20 } });
  if (disposed) expect(setPosition).not.toHaveBeenCalled();
  else expect(setPosition).toHaveBeenCalledWith(10, 20);

  dispose();
  expect(win.unlistenMoved).toHaveBeenCalledOnce();
});
