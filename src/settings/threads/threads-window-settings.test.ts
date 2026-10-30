// @vitest-environment jsdom
/** threads-window-settings.test.ts — the Threads window's per-device frame and list choice, floored at the minimum panel. */

import { afterEach, expect, it } from "vitest";
import {
  createThreadsWindowSettings,
  localStorageThreadsWindowStorage,
} from "./threads-window-settings";

const KEY = "yui.test.threads-window";
afterEach(() => globalThis.localStorage?.removeItem(KEY));

const DEFAULTS = { width: 880, height: 680, listCollapsed: false };

it.each([
  ["nothing stored", null],
  ["a size below the minimum", { width: 200, height: 680, listCollapsed: false }],
  ["a fractional size", { width: 880.5, height: 680, listCollapsed: false }],
  ["a position with only x", { x: 10, width: 880, height: 680, listCollapsed: false }],
  ["a non-boolean list choice", { width: 880, height: 680, listCollapsed: "yes" }],
])("starts from the defaults with %s", (_name, stored) => {
  if (stored) globalThis.localStorage?.setItem(KEY, JSON.stringify(stored));

  const settings = createThreadsWindowSettings({ storage: localStorageThreadsWindowStorage(KEY) });

  expect(settings.get()).toEqual(DEFAULTS);
});

it("keeps a frame saved below the minimum at the minimum after a reload", () => {
  const storage = localStorageThreadsWindowStorage(KEY);
  // A work area too small for the minimum box applied a 276 × 376 box: a 260 × 360 panel.
  createThreadsWindowSettings({ storage }).setFrame({ x: 20, y: 20, width: 260, height: 360 });

  expect(createThreadsWindowSettings({ storage }).get()).toEqual({
    x: 20,
    y: 20,
    width: 360,
    height: 420,
    listCollapsed: false,
  });
});

it("keeps the list choice and the frame side by side", () => {
  const storage = localStorageThreadsWindowStorage(KEY);
  const settings = createThreadsWindowSettings({ storage });
  settings.setFrame({ x: 100.4, y: -300, width: 640, height: 560 });
  settings.setListCollapsed(true);

  expect(createThreadsWindowSettings({ storage }).get()).toEqual({
    x: 100,
    y: -300,
    width: 640,
    height: 560,
    listCollapsed: true,
  });
});
