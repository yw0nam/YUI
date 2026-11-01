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

it("keeps a dragged list width beside the frame, and a reset clears it", () => {
  const storage = localStorageThreadsWindowStorage(KEY);
  const settings = createThreadsWindowSettings({ storage });
  settings.setFrame({ x: 10, y: 20, width: 880, height: 680 });
  settings.setListWidth(312);

  expect(createThreadsWindowSettings({ storage }).get()).toEqual({
    x: 10,
    y: 20,
    width: 880,
    height: 680,
    listCollapsed: false,
    listWidth: 312,
  });

  settings.setListWidth(null);
  expect(createThreadsWindowSettings({ storage }).get()).toEqual({
    x: 10,
    y: 20,
    width: 880,
    height: 680,
    listCollapsed: false,
  });
});

it("loads a frame stored without a list width, and ignores a list width that is not whole px", () => {
  globalThis.localStorage?.setItem(
    KEY,
    JSON.stringify({ x: 5, y: 6, width: 900, height: 700, listCollapsed: true }),
  );
  expect(
    createThreadsWindowSettings({ storage: localStorageThreadsWindowStorage(KEY) }).get(),
  ).toEqual({ x: 5, y: 6, width: 900, height: 700, listCollapsed: true });

  globalThis.localStorage?.setItem(
    KEY,
    JSON.stringify({ x: 5, y: 6, width: 900, height: 700, listCollapsed: true, listWidth: "wide" }),
  );
  expect(
    createThreadsWindowSettings({ storage: localStorageThreadsWindowStorage(KEY) }).get(),
  ).toEqual({ x: 5, y: 6, width: 900, height: 700, listCollapsed: true });
});

it.each([
  ["a size in the range", 18, 18],
  ["a size above the range", 30, undefined],
  ["a size below the range", 9, undefined],
  ["a fractional size", 13.5, undefined],
])("reads the terminal font size with %s, keeping the frame", (_name, stored, size) => {
  globalThis.localStorage?.setItem(
    KEY,
    JSON.stringify({
      x: 5,
      y: 6,
      width: 640,
      height: 560,
      listCollapsed: true,
      terminalFontSize: stored,
    }),
  );

  const settings = createThreadsWindowSettings({ storage: localStorageThreadsWindowStorage(KEY) });

  expect(settings.get()).toStrictEqual({
    x: 5,
    y: 6,
    width: 640,
    height: 560,
    listCollapsed: true,
    ...(size === undefined ? {} : { terminalFontSize: size }),
  });
});

it("keeps the terminal font size after a reload, beside the frame, and gives 13 px before one is set", () => {
  const storage = localStorageThreadsWindowStorage(KEY);
  const settings = createThreadsWindowSettings({ storage });
  expect(settings.terminalFontSize()).toBe(13);
  settings.setTerminalFontSize(16);

  const reloaded = createThreadsWindowSettings({ storage });
  expect(reloaded.get()).toEqual({ ...DEFAULTS, terminalFontSize: 16 });
  expect(reloaded.terminalFontSize()).toBe(16);
});
