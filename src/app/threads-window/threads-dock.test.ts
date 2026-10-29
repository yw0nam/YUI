// @vitest-environment jsdom
/**
 * threads-dock.test.ts — how the Threads window docks beside main's pet window on each open,
 * detaches on a head drag, snaps back on a near drop and follows the pet window while docked.
 * The drag runs through the `drag_window` command; its drop is the `window_drop_release` event.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { win, getCurrentWindow, availableMonitors, primaryMonitor } = vi.hoisted(() => {
  const win = {
    setSize: vi.fn(async (_arg: unknown) => {}),
    setPosition: vi.fn(async (_arg: unknown) => {}),
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    outerPosition: vi.fn(async () => ({ x: 912, y: 100 })),
    scaleFactor: vi.fn(async () => 1),
    onMoved: vi.fn((_cb: (event: { payload: { x: number; y: number } }) => void) => () => {}),
  };
  return {
    win,
    getCurrentWindow: vi.fn(() => win),
    availableMonitors: vi.fn(async () => [MONITOR]),
    primaryMonitor: vi.fn(async () => MONITOR),
  };
});

const { getByLabel, owner } = vi.hoisted(() => {
  const owner = {
    outerPosition: vi.fn(async () => ({ x: 500, y: 100 })),
    outerSize: vi.fn(async () => ({ width: 400, height: 600 })),
    scaleFactor: vi.fn(async () => 1),
    onMoved: vi.fn((_cb: (event: { payload: { x: number; y: number } }) => void) => () => {}),
  };
  return { owner, getByLabel: vi.fn(async () => owner) };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow,
  availableMonitors,
  primaryMonitor,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel },
}));

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined),
  listen: vi.fn(async (_event: string, _cb: () => void) => () => {}),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const MONITOR = {
  position: { x: 0, y: 0 },
  size: { width: 2000, height: 1000 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 1000 } },
  scaleFactor: 1,
};

import { wireThreadsDock } from "./threads-dock";

/** The release poll's `window_drop_release`, which every window hears after any native drag. */
function dropRelease(): void {
  for (const [event, cb] of listen.mock.calls) if (event === "window_drop_release") cb();
}

/** The native drag has started; its release can only come after it. */
const dragStarted = () => vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("drag_window"));

/** Lets the dock's queued steps run. */
const settle = () => new Promise((r) => setTimeout(r, 20));

/** The chip's screen rect, under the pet window where the chip column sits. */
const CHIP = { x: 860, y: 700, width: 120, height: 32 };

/** The docked window rect for the owner at (500, 100): 12px right of her window, kept 12px inside the work area. */
const DOCKED = { x: 912, y: 100, width: 960, height: 820 };

/** The grow origin the open resolves with: the chip's size at the window edge nearest the chip. */
const GROW_FROM = { x: 0, y: 600, width: 120, height: 32 };

function positions(): Array<{ x: number; y: number }> {
  return win.setPosition.mock.calls.map((call) => {
    const arg = call[0] as { x: number; y: number };
    return { x: arg.x, y: arg.y };
  });
}

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  win.setSize.mockClear();
  win.setPosition.mockClear();
  win.show.mockClear();
  win.hide.mockClear();
  win.setFocus.mockClear();
  invoke.mockClear();
  listen.mockClear();
  win.outerPosition.mockClear();
  win.outerPosition.mockImplementation(async () => ({ x: 912, y: 100 }));
  win.onMoved.mockClear();
  owner.outerPosition.mockClear();
  owner.outerPosition.mockImplementation(async () => ({ x: 500, y: 100 }));
  owner.onMoved.mockClear();
  getByLabel.mockClear();
  getByLabel.mockImplementation(async () => owner);
});

afterEach(() => vi.unstubAllGlobals());

function wired() {
  const headCbs = new Set<(e: PointerEvent) => void>();
  const dock = wireThreadsDock({
    head: {
      onHeadPointerDown: (cb) => {
        headCbs.add(cb);
        return () => headCbs.delete(cb);
      },
    },
  });
  return {
    dock,
    headPointerDown: () => {
      for (const cb of [...headCbs]) cb(new PointerEvent("pointerdown"));
    },
  };
}

describe("wireThreadsDock", () => {
  it("opens docked 12px right of the pet window's roomier side, sized and shown, and grows from the chip", async () => {
    const { dock } = wired();

    const from = await dock.open(CHIP);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());

    expect(win.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 960, height: 820 }));
    expect(positions()[0]).toEqual({ x: DOCKED.x, y: DOCKED.y });
    expect(win.show).toHaveBeenCalledOnce();
    expect(getByLabel).toHaveBeenCalledWith("main");
    expect(from).toEqual(GROW_FROM);
  });

  it("links its window to the pet window after placing it", async () => {
    const { dock } = wired();

    await dock.open(CHIP);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());

    expect(invoke).toHaveBeenCalledWith("window_dock_attach", { parentLabel: "main" });
    const attach = invoke.mock.calls.findIndex(([cmd]) => cmd === "window_dock_attach");
    expect(invoke.mock.invocationCallOrder[attach]!).toBeGreaterThan(
      win.setPosition.mock.invocationCallOrder[0]!,
    );
  });

  it("unlinks before a head drag starts the native drag", async () => {
    const { dock, headPointerDown } = wired();
    await dock.open(CHIP);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());
    invoke.mockClear();

    headPointerDown();
    await dragStarted();

    expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(["window_dock_detach", "drag_window"]);
  });

  it("unlinks before it hides", async () => {
    const { dock } = wired();
    await dock.open(CHIP);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());
    invoke.mockClear();

    await dock.hide();

    expect(invoke).toHaveBeenCalledWith("window_dock_detach");
    expect(invoke.mock.invocationCallOrder[0]!).toBeLessThan(win.hide.mock.invocationCallOrder[0]!);
  });

  it("snaps a drop near the pet window's edge back into the dock and links again", async () => {
    const { dock, headPointerDown } = wired();
    await dock.open(CHIP);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    // Visible panel left edge 910 + 8 = 918, 18px past her window's right edge 900.
    win.outerPosition.mockImplementation(async () => ({ x: 910, y: 100 }));
    headPointerDown();
    win.onMoved.mock.calls[0][0]({ payload: { x: 910, y: 100 } });
    dropRelease();
    await settle();

    expect(positions()).toEqual([{ x: DOCKED.x, y: DOCKED.y }]);
    expect(invoke).toHaveBeenCalledWith("window_dock_attach", { parentLabel: "main" });
  });

  it("keeps a drop far from the pet window detached where it landed", async () => {
    const { dock, headPointerDown } = wired();
    await dock.open(CHIP);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());
    win.setPosition.mockClear();
    invoke.mockClear();

    win.outerPosition.mockImplementation(async () => ({ x: 1400, y: 100 }));
    headPointerDown();
    win.onMoved.mock.calls[0][0]({ payload: { x: 1400, y: 100 } });
    dropRelease();
    await settle();

    expect(positions()).toEqual([]);
    expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(["window_dock_detach", "drag_window"]);
  });

  it("moves a docked window by the pet window's delta and keeps its side", async () => {
    const { dock } = wired();
    await dock.open(CHIP);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 120 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 120 } });
    await vi.waitFor(() => expect(positions()).toEqual([{ x: 1012, y: 120 }]));
  });

  it("docks again on the next open after a detached drop", async () => {
    const { dock, headPointerDown } = wired();
    await dock.open(CHIP);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());

    win.outerPosition.mockImplementation(async () => ({ x: 1400, y: 100 }));
    headPointerDown();
    win.onMoved.mock.calls[0][0]({ payload: { x: 1400, y: 100 } });
    dropRelease();
    await settle();
    win.setSize.mockClear();
    win.setPosition.mockClear();
    win.show.mockClear();

    const from = await dock.open(CHIP);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());

    expect(win.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 960, height: 820 }));
    expect(positions()).toEqual([{ x: DOCKED.x, y: DOCKED.y }]);
    expect(from).toEqual(GROW_FROM);
    expect(invoke).toHaveBeenCalledWith("window_dock_attach", { parentLabel: "main" });
  });

  describe("with the native child link (macOS)", () => {
    beforeEach(() => {
      invoke.mockImplementation(async (cmd: string) =>
        cmd === "window_dock_attach" ? true : cmd === "window_dock_detach" ? false : undefined,
      );
    });

    it("leaves a docked window's travel with the pet window to the link", async () => {
      const { dock } = wired();
      await dock.open(CHIP);
      await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());
      win.setPosition.mockClear();

      owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 120 }));
      owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 120 } });
      await settle();

      expect(positions()).toEqual([]);
    });

    it("switches sides with one move when travelling with her would carry it off the work area", async () => {
      const { dock } = wired();
      await dock.open(CHIP);
      await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());
      win.setPosition.mockClear();

      // Moved with her by 1000, the window would end at 912 + 1000 + 960 = 2872, past 2000;
      // docked on her left instead: her left edge 1500, less 12, 960.
      owner.outerPosition.mockImplementation(async () => ({ x: 1500, y: 100 }));
      owner.onMoved.mock.calls[0][0]({ payload: { x: 1500, y: 100 } });
      await settle();

      expect(positions()).toEqual([{ x: 528, y: 100 }]);
    });
  });
});
