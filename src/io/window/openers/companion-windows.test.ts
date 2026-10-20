// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getByLabel, destroyed, selfClose } = vi.hoisted(() => ({
  getByLabel: vi.fn(),
  destroyed: vi.fn(),
  selfClose: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel } }));

import { watchOwner } from "./companion-windows";

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  getByLabel.mockImplementation(async () => ({ once: destroyed }));
  destroyed.mockImplementation(async () => () => {});
});
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])("closes when owner is absent or destroyed (exists: %s)", async (exists) => {
  if (!exists) getByLabel.mockResolvedValue(null);
  const watcher = await watchOwner("a", selfClose);
  if (exists) destroyed.mock.calls[0]![1]();
  expect(selfClose).toHaveBeenCalledTimes(1);
  expect(watcher.alive).toBe(false);
  watcher.dispose();
});
