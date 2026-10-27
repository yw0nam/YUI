// @vitest-environment jsdom
/**
 * quick-card-dock.test.ts — how the quick-card window places itself docked beside the character,
 * follows her window while docked, detaches on a head drag and snaps back on a near drop.
 * The drag runs through the `drag_window` command; its drop is the `window_drop_release` event.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, getCurrentWindow, availableMonitors, primaryMonitor } = vi.hoisted(() => {
  const win = {
    setSize: vi.fn(async (_arg: unknown) => {}),
    setPosition: vi.fn(async (_arg: unknown) => {}),
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    outerPosition: vi.fn(async () => ({ x: 1000, y: 200 })),
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
    outerPosition: vi.fn(async () => ({ x: 500, y: 300 })),
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
  invoke: vi.fn(async (_cmd: string) => {}),
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

import { wireQuickCardDock } from "./quick-card-dock";

/** The release poll's `window_drop_release`, which every window hears after any native drag. */
function dropRelease(): void {
  for (const [event, cb] of listen.mock.calls) if (event === "window_drop_release") cb();
}

/** Lets the dock's queued steps run. */
const settle = () => new Promise((r) => setTimeout(r, 20));

function fakeBridge() {
  let onOpen: ((request: never) => void) | null = null;
  return {
    onQuickCardOpen: (cb: (request: never) => void) => {
      onOpen = cb;
      return () => {};
    },
    emitQuickCardReady: vi.fn(),
    open: (request: { left: number; right: number; y: number; listening?: boolean }) =>
      onOpen?.(request as never),
  };
}

function fakeCard() {
  const headCbs = new Set<(e: PointerEvent) => void>();
  return {
    open: vi.fn(),
    isOpen: vi.fn(() => true),
    contentSize: () => ({ width: 272, height: 400 }),
    el: document.createElement("div"),
    onHeadPointerDown: (cb: (e: PointerEvent) => void) => {
      headCbs.add(cb);
      return () => headCbs.delete(cb);
    },
    headPointerDown: () => {
      for (const cb of [...headCbs]) cb(new PointerEvent("pointerdown"));
    },
  };
}

function seedListen() {
  const seen: boolean[] = [];
  const listen = (listening: boolean): void => {
    seen.push(listening);
  };
  return Object.assign(listen, { seen });
}

/** The docked window box for a card opened from the owner at (500, 300) with the test request. */
const DOCKED = { x: 864, y: 468 };
const REQUEST = { left: 40, right: 360, y: 200, listening: true };

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
  win.outerPosition.mockImplementation(async () => ({ x: 1000, y: 200 }));
  win.onMoved.mockClear();
  owner.outerPosition.mockClear();
  owner.outerPosition.mockImplementation(async () => ({ x: 500, y: 300 }));
  owner.onMoved.mockClear();
  getByLabel.mockClear();
  getByLabel.mockImplementation(async () => owner);
});

function wired() {
  const bridge = fakeBridge();
  const card = fakeCard();
  const listen = seedListen();
  wireQuickCardDock({
    bridge,
    card,
    seedListen: listen,
    ownerLabel: "pet-a",
  });
  return { bridge, card, listen };
}

describe("wireQuickCardDock", () => {
  it("hides its window at boot, then reports ready", async () => {
    const { bridge } = wired();

    // A reload while the card showed leaves the window shown with no card in it.
    await vi.waitFor(() => expect(bridge.emitQuickCardReady).toHaveBeenCalledOnce());
    expect(win.hide).toHaveBeenCalledOnce();
    expect(win.hide.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.emitQuickCardReady.mock.invocationCallOrder[0]!,
    );
  });

  it("opens the card docked 12px right of her roomier side, sized to the card, shown and focused", async () => {
    const { bridge, card, listen } = wired();

    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.setFocus).toHaveBeenCalledOnce());

    expect(card.open).toHaveBeenCalledOnce();
    expect(listen.seen).toEqual([true]);
    expect(win.setSize.mock.calls[0][0]).toMatchObject({ width: 288, height: 416 });
    expect(positions()[0]).toEqual(DOCKED);
    expect(win.setFocus).toHaveBeenCalledOnce();
    expect(getByLabel).toHaveBeenCalledWith("pet-a");
  });

  it("moves a docked card by the owner's delta and keeps its side", async () => {
    const { bridge } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await vi.waitFor(() => expect(positions()).toEqual([{ x: 964, y: 488 }]));
  });

  it("leaves a closed card where it is when the owner moves", async () => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();
    card.isOpen.mockReturnValue(false);

    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await new Promise((r) => setTimeout(r, 20));

    expect(positions()).toEqual([]);
  });

  it.each([
    ["one long step", [1200]],
    ["1px steps", Array.from({ length: 336 }, (_, i) => DOCKED.x + 1 + i)],
  ])("stops following once a move of its own window detaches it (%s)", async (_name, xs) => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    card.headPointerDown();
    expect(invoke).toHaveBeenCalledWith("drag_window");
    win.outerPosition.mockImplementation(async () => ({ x: 1200, y: 400 }));
    for (const x of xs) win.onMoved.mock.calls[0][0]({ payload: { x, y: DOCKED.y } });
    dropRelease();
    await settle();

    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await settle();
    expect(positions()).toEqual([]);
  });

  it("keeps a head click without movement docked and following", async () => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    card.headPointerDown();
    dropRelease();
    await settle();

    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await vi.waitFor(() => expect(positions()).toEqual([{ x: 964, y: 488 }]));
  });

  it("settles a drop on the release, not when the drag call returns", async () => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    // The drag call returns at once; the window then moves under the held button.
    win.outerPosition.mockImplementation(async () => ({ x: 240, y: 400 }));
    card.headPointerDown();
    await settle();
    win.onMoved.mock.calls[0][0]({ payload: { x: 240, y: 400 } });
    await settle();
    expect(positions()).toEqual([]);

    dropRelease();
    await vi.waitFor(() => expect(positions()).toEqual([{ x: 248, y: 400 }]));
  });

  it.each([
    // Visible right edge 240 + 8 + 272 = 520, 20px short of her left edge 540.
    [
      "within 24px of her left side snaps and docks",
      240,
      [{ x: 248, y: 400 }],
      [{ x: 348, y: 420 }],
    ],
    // Visible left edge 872 + 8 = 880, 20px past her right edge 860.
    [
      "within 24px of her right side snaps and docks",
      872,
      [{ x: 864, y: 400 }],
      [{ x: 964, y: 420 }],
    ],
    // Visible right edge 235 + 8 + 272 = 515, 25px short of her left edge 540.
    ["25px from her edge stays detached", 235, [], []],
  ])("a drop %s", async (_name, droppedX, snapped, followed) => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    win.outerPosition.mockImplementation(async () => ({ x: droppedX, y: 400 }));
    card.headPointerDown();
    win.onMoved.mock.calls[0][0]({ payload: { x: droppedX, y: 400 } });
    dropRelease();
    await settle();
    expect(positions()).toEqual(snapped);

    // Docked again, the owner's next move carries the card along; detached, it stays.
    win.setPosition.mockClear();
    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await settle();
    expect(positions()).toEqual(followed);
  });

  it("follows her from where she stood at the snap, however far she went while it was detached", async () => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    const dragTo = async (x: number) => {
      win.outerPosition.mockImplementation(async () => ({ x, y: 400 }));
      card.headPointerDown();
      win.onMoved.mock.calls[0][0]({ payload: { x, y: 400 } });
      dropRelease();
      await settle();
    };
    const moveOwner = async (x: number) => {
      owner.outerPosition.mockImplementation(async () => ({ x, y: 300 }));
      owner.onMoved.mock.calls[0][0]({ payload: { x, y: 300 } });
      await settle();
    };

    await dragTo(1200);
    await moveOwner(800);
    win.setPosition.mockClear();
    // Her left edge is now 840; the card's visible right edge 540 + 8 + 272 = 820 sits 20px short.
    await dragTo(540);
    await moveOwner(805);

    expect(positions()).toEqual([
      { x: 548, y: 400 },
      { x: 553, y: 400 },
    ]);
  });

  it("does not snap a detached card when her own drag ends beside it", async () => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.outerPosition.mockImplementation(async () => ({ x: 1200, y: 400 }));
    card.headPointerDown();
    win.onMoved.mock.calls[0][0]({ payload: { x: 1200, y: 400 } });
    dropRelease();
    await settle();
    win.setPosition.mockClear();

    // She is dragged so her right edge (830 + 360) sits 18px from the card's visible left edge.
    owner.outerPosition.mockImplementation(async () => ({ x: 830, y: 300 }));
    dropRelease();
    await settle();

    expect(positions()).toEqual([]);
  });
});
