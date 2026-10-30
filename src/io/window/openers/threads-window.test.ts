// @vitest-environment jsdom
/** threads-window.test.ts — main's Threads window controller: the create, the ready/open handshake, and a failed request to the open window. */

import { beforeEach, expect, it, vi } from "vitest";

const { WebviewWindow, getByLabel, innerPosition } = vi.hoisted(() => ({
  innerPosition: vi.fn(async () => ({ x: 200, y: 100 })),
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
    innerPosition,
    scaleFactor: async () => 2,
  }),
}));

import { createThreadsWindowController } from "./threads-window";

function bridge() {
  const cbs = { ready: new Set<() => void>(), closed: new Set<() => void>() };
  const sent: unknown[] = [];
  const on = (set: Set<() => void>) => (cb: () => void) => {
    set.add(cb);
    return () => set.delete(cb);
  };
  return {
    emitThreadsOpen: (request: unknown) => void sent.push(request),
    onThreadsReady: on(cbs.ready),
    onThreadsClosed: on(cbs.closed),
    fire: (name: keyof typeof cbs) => {
      for (const cb of [...cbs[name]]) cb();
    },
    sent,
  };
}

const CHIP = { x: 10, y: 20, width: 100, height: 30 };

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  getByLabel.mockResolvedValue(null);
  innerPosition.mockImplementation(async () => ({ x: 200, y: 100 }));
});

it("creates the hidden window and holds an open made before its ready report", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b, onClosed: vi.fn() });

  expect(controller.open(CHIP)).toBe(true);
  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledTimes(1));
  expect(WebviewWindow).toHaveBeenCalledWith(
    "threads",
    expect.objectContaining({
      url: "threads.html",
      decorations: false,
      transparent: true,
      alwaysOnTop: false,
      skipTaskbar: true,
      visible: false,
      acceptFirstMouse: true,
    }),
  );
  expect(b.sent).toEqual([]);

  b.fire("ready");

  await vi.waitFor(() =>
    expect(b.sent).toEqual([{ chip: { x: 110, y: 70, width: 100, height: 30 } }]),
  );
});

it("keeps the open state when a request to the open window fails", async () => {
  const b = bridge();
  const onClosed = vi.fn();
  const controller = createThreadsWindowController({ bridge: b, onClosed });
  controller.open(CHIP);
  b.fire("ready");
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));

  innerPosition.mockRejectedValueOnce(new Error("window gone"));
  controller.open(CHIP);
  await vi.waitFor(() => expect(innerPosition).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(onClosed).not.toHaveBeenCalled();
});
