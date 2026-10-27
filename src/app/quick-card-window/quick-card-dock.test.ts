// @vitest-environment jsdom
/**
 * quick-card-dock.test.ts — how the quick-card window places itself docked beside the character,
 * follows her window while docked, detaches on a head drag and snaps back on a near drop.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, getCurrentWindow, availableMonitors, primaryMonitor } = vi.hoisted(() => {
  const win = {
    setSize: vi.fn(async (_arg: unknown) => {}),
    setPosition: vi.fn(async (_arg: unknown) => {}),
    show: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    startDragging: vi.fn(async () => {}),
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

const MONITOR = {
  position: { x: 0, y: 0 },
  size: { width: 2000, height: 1000 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 1000 } },
  scaleFactor: 1,
};

import { wireQuickCardDock } from "./quick-card-dock";

/** The native drag resolves at mouse-up; the tests hold it until the drop. */
let releaseDrag: (() => void) | null = null;
function dropDrag(): void {
  releaseDrag?.();
  releaseDrag = null;
}

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
    cardSize: () => ({ width: 272, height: 400 }),
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
  win.setFocus.mockClear();
  win.startDragging.mockClear();
  win.startDragging.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        releaseDrag = resolve;
      }),
  );
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
  it("reports ready at boot", () => {
    const { bridge } = wired();
    expect(bridge.emitQuickCardReady).toHaveBeenCalledOnce();
  });

  it("opens the card docked 12px right of her roomier side, sized to the card, shown and focused", async () => {
    const { bridge, card, listen } = wired();

    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());

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

  it.each([
    ["one long step", [1200]],
    ["1px steps", Array.from({ length: 336 }, (_, i) => DOCKED.x + 1 + i)],
  ])("stops following once a move of its own window detaches it (%s)", async (_name, xs) => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    card.headPointerDown();
    await vi.waitFor(() => expect(win.startDragging).toHaveBeenCalledOnce());

    win.outerPosition.mockImplementation(async () => ({ x: 1200, y: 400 }));
    for (const x of xs) win.onMoved.mock.calls[0][0]({ payload: { x, y: DOCKED.y } });
    dropDrag();
    await new Promise((r) => setTimeout(r, 20));

    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(positions()).toEqual([]);
  });

  it("keeps a head click without movement docked and following", async () => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    card.headPointerDown();
    await vi.waitFor(() => expect(win.startDragging).toHaveBeenCalledOnce());
    dropDrag();
    await new Promise((r) => setTimeout(r, 20));

    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await vi.waitFor(() => expect(positions()).toEqual([{ x: 964, y: 488 }]));
  });

  it.each([
    ["left", 240, { x: 248, y: 400 }],
    ["right", 872, { x: 864, y: 400 }],
  ])("snaps a drop whose visible edge sits within 24px of her %s side", async (_side, droppedX, snapped) => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    win.outerPosition.mockImplementation(async () => ({ x: droppedX, y: 400 }));
    card.headPointerDown();
    await vi.waitFor(() => expect(win.startDragging).toHaveBeenCalledTimes(1));
    win.onMoved.mock.calls[0][0]({ payload: { x: droppedX, y: 400 } });
    dropDrag();
    await vi.waitFor(() => expect(positions()).toEqual([snapped]));

    // Docked again: the owner's next move carries the snapped card along.
    win.setPosition.mockClear();
    owner.outerPosition.mockImplementation(async () => ({ x: 600, y: 320 }));
    owner.onMoved.mock.calls[0][0]({ payload: { x: 600, y: 320 } });
    await vi.waitFor(() =>
      expect(positions()).toEqual([{ x: snapped.x + 100, y: snapped.y + 20 }]),
    );
  });

  it("leaves a drop 25px from her edge detached", async () => {
    const { bridge, card } = wired();
    bridge.open(REQUEST);
    await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());
    win.setPosition.mockClear();

    // Visible right edge 235 + 288 - 8 = 515, 25px short of her left edge 540.
    win.outerPosition.mockImplementation(async () => ({ x: 235, y: 400 }));
    card.headPointerDown();
    await vi.waitFor(() => expect(win.startDragging).toHaveBeenCalledTimes(1));
    win.onMoved.mock.calls[0][0]({ payload: { x: 235, y: 400 } });
    dropDrag();
    await new Promise((r) => setTimeout(r, 20));

    expect(positions()).toEqual([]);
  });
});
