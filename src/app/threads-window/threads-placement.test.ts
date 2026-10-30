// @vitest-environment jsdom
/**
 * threads-placement.test.ts — where the Threads window opens (beside main's pet window the first
 * time, at its stored frame after that), the frame it saves, and its head drag.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { win, owner } = vi.hoisted(() => ({
  win: {
    setSize: vi.fn(async (_arg: unknown) => {}),
    setPosition: vi.fn(async (_arg: unknown) => {}),
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    outerPosition: vi.fn(async () => ({ x: 912, y: 100 })),
    outerSize: vi.fn(async () => ({ width: 896, height: 696 })),
    scaleFactor: vi.fn(async () => 1),
    onMoved: vi.fn(async (_cb: () => void) => () => {}),
  },
  owner: {
    outerPosition: vi.fn(async () => ({ x: 500, y: 100 })),
    outerSize: vi.fn(async () => ({ width: 400, height: 600 })),
    scaleFactor: vi.fn(async () => 1),
  },
}));
const MONITOR = {
  position: { x: 0, y: 0 },
  size: { width: 2000, height: 1000 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 1000 } },
  scaleFactor: 1,
};
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
  availableMonitors: async () => [MONITOR],
  primaryMonitor: async () => MONITOR,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: async (label: string) => (label === "main" ? owner : null) },
}));
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (_cmd: string) => undefined) }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

import type { ScreenRect } from "../../contract";
import { createThreadsPlacement } from "./threads-placement";

/** The chip's screen rect, under the pet window where the chip column sits. */
const CHIP = { x: 860, y: 700, width: 120, height: 32 };

function placement(stored: { x?: number; y?: number; width: number; height: number }) {
  const setFrame = vi.fn((_frame: ScreenRect) => {});
  return {
    setFrame,
    placement: createThreadsPlacement({
      settings: { get: () => ({ ...stored, listCollapsed: false }), setFrame },
    }),
  };
}

const sizes = () => win.setSize.mock.calls.map(([arg]) => ({ ...(arg as object) }));
const positions = () => win.setPosition.mock.calls.map(([arg]) => ({ ...(arg as object) }));
/** The window's own moved event, as the OS reports a move. */
const moved = () => {
  for (const [cb] of win.onMoved.mock.calls) cb();
};

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  for (const fn of [win.setSize, win.setPosition, win.show, win.hide, win.setFocus, invoke])
    fn.mockClear();
  win.outerPosition.mockImplementation(async () => ({ x: 912, y: 100 }));
  win.outerSize.mockImplementation(async () => ({ width: 896, height: 696 }));
  win.scaleFactor.mockImplementation(async () => 1);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("opens 12px beside the pet window on its first open, shown and focused, grows from the chip, and saves that frame", async () => {
  const { placement: p, setFrame } = placement({ width: 880, height: 680 });

  const from = await p.open(CHIP);

  expect(sizes()).toEqual([{ type: "Logical", width: 896, height: 696 }]);
  expect(positions()).toEqual([{ type: "Logical", x: 912, y: 100 }]);
  expect(win.show).toHaveBeenCalledOnce();
  expect(win.setFocus).toHaveBeenCalledOnce();
  expect(from).toEqual({ x: 0, y: 600, width: 120, height: 32 });
  expect(setFrame).toHaveBeenCalledWith({ x: 920, y: 108, width: 880, height: 680 });
});

it("reopens at its stored frame", async () => {
  const { placement: p } = placement({ x: 108, y: 208, width: 640, height: 560 });

  await p.open(CHIP);

  expect(sizes()).toEqual([{ type: "Logical", width: 656, height: 576 }]);
  expect(positions()).toEqual([{ type: "Logical", x: 100, y: 200 }]);
});

it("saves a move the user made once it settles, in logical px at the window's current scale, but not its own placement", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { placement: p, setFrame } = placement({ x: 920, y: 108, width: 880, height: 680 });
  await p.open(CHIP);
  setFrame.mockClear();

  moved();
  await vi.advanceTimersByTimeAsync(400);
  expect(setFrame).not.toHaveBeenCalled();

  // Dragged onto a Retina monitor: 600, 400 physical px at scale 2.
  win.scaleFactor.mockImplementation(async () => 2);
  win.outerPosition.mockImplementation(async () => ({ x: 600, y: 400 }));
  moved();
  await vi.advanceTimersByTimeAsync(400);
  expect(setFrame).toHaveBeenCalledWith({ x: 308, y: 208, width: 880, height: 680 });
});

it("saves a move still settling before it hides", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { placement: p, setFrame } = placement({ x: 920, y: 108, width: 880, height: 680 });
  await p.open(CHIP);
  setFrame.mockClear();

  win.outerPosition.mockImplementation(async () => ({ x: 300, y: 200 }));
  moved();
  await p.hide();

  expect(setFrame).toHaveBeenCalledWith({ x: 308, y: 208, width: 880, height: 680 });
  expect(win.hide).toHaveBeenCalledOnce();
});

it("reads a resize's origin from the window's live position and size at its current scale", async () => {
  const { placement: p } = placement({ x: 920, y: 108, width: 880, height: 680 });
  await p.open(CHIP);

  win.scaleFactor.mockImplementation(async () => 2);
  win.outerPosition.mockImplementation(async () => ({ x: 1200, y: 400 }));
  win.outerSize.mockImplementation(async () => ({ width: 1400, height: 1000 }));

  expect(await p.current()).toEqual({
    box: { x: 600, y: 200, width: 700, height: 500 },
    workArea: { x: 0, y: 0, width: 2000, height: 1000 },
  });
});

it("starts the native drag from a head pointerdown", async () => {
  const { placement: p } = placement({ width: 880, height: 680 });

  p.startDrag();

  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("drag_window"));
});
