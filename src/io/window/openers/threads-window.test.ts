// @vitest-environment jsdom
/** threads-window.test.ts — main's Threads window controller: the create, the ready/open handshake, a failed request to the open window, and present() settling once. */

import { beforeEach, expect, it, type Mock, vi } from "vitest";

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
  const presented = new Set<(report: { present: string }) => void>();
  const sent: unknown[] = [];
  const on = (set: Set<() => void>) => (cb: () => void) => {
    set.add(cb);
    return () => set.delete(cb);
  };
  return {
    emitThreadsOpen: (request: unknown) => void sent.push(request),
    onThreadsReady: on(cbs.ready),
    onThreadsClosed: on(cbs.closed),
    onThreadsPresented: (cb: (report: { present: string }) => void) => {
      presented.add(cb);
      return () => presented.delete(cb);
    },
    firePresented: (present: string) => {
      for (const cb of [...presented]) cb({ present });
    },
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
  const controller = createThreadsWindowController({ bridge: b });

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
  const onShown = vi.fn();
  const controller = createThreadsWindowController({ bridge: b });
  controller.onShown(onShown);
  controller.open(CHIP);
  b.fire("ready");
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));

  innerPosition.mockRejectedValueOnce(new Error("window gone"));
  controller.open(CHIP);
  await vi.waitFor(() => expect(innerPosition).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(onShown).not.toHaveBeenCalledWith(false);
});

const sentId = (b: ReturnType<typeof bridge>, index = 0): string =>
  (b.sent[index] as { present: string }).present;

it("isOpen is true from a handed request until the closed report", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  expect(controller.isOpen()).toBe(false);

  controller.open(CHIP);
  await vi.waitFor(() => expect(controller.isOpen()).toBe(true));
  b.fire("closed");

  expect(controller.isOpen()).toBe(false);
});

it("present sends a no-focus request on the Threads tab with a fresh id and resolves on that id's report", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  b.fire("ready");

  const result = controller.present(CHIP, { thread: "t1" });
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));

  expect(b.sent[0]).toEqual({
    chip: { x: 110, y: 70, width: 100, height: 30 },
    tab: "threads",
    thread: "t1",
    focus: false,
    present: expect.any(String),
  });
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  b.firePresented("another-id");
  await Promise.resolve();
  expect(settled).toBe(false);

  b.firePresented(sentId(b));
  await expect(result).resolves.toBe("presented");
});

it("present without a Thread or a chip sends a bare no-focus request", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  b.fire("ready");

  void controller.present();
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));

  expect(b.sent[0]).toEqual({ focus: false, present: expect.any(String) });
});

it("a present made before the ready report is sent with its own id once the window is ready", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  const first = controller.present(CHIP, { thread: "t1" });
  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalled());
  expect(b.sent).toEqual([]);

  b.fire("ready");
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));
  b.firePresented(sentId(b));

  await expect(first).resolves.toBe("presented");
});

it("two presents carry distinct ids and each resolves on its own report", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  b.fire("ready");
  const first = controller.present();
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));
  const second = controller.present();
  await vi.waitFor(() => expect(b.sent).toHaveLength(2));
  expect(sentId(b, 0)).not.toBe(sentId(b, 1));

  b.firePresented(sentId(b, 1));
  await expect(second).resolves.toBe("presented");
  b.firePresented(sentId(b, 0));
  await expect(first).resolves.toBe("presented");
});

it("present resolves closed on the closed report", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  b.fire("ready");
  const result = controller.present(CHIP);
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));

  b.fire("closed");

  await expect(result).resolves.toBe("closed");
});

it("present resolves closed when the window reports a creation error", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  const result = controller.present();
  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalled());
  const { once } = WebviewWindow.mock.instances[0] as unknown as { once: Mock };
  const [, fail] = once.mock.calls.find(([name]) => name === "tauri://error") ?? [];

  fail({ payload: "boom" });

  await expect(result).resolves.toBe("closed");
});

it("present resolves closed when the chip rect cannot be placed", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  innerPosition.mockRejectedValueOnce(new Error("window gone"));

  await expect(controller.present(CHIP)).resolves.toBe("closed");
  expect(innerPosition).toHaveBeenCalledTimes(1);
  expect(b.sent).toEqual([]);
});

it("present resolves closed on dispose and ignores a report that comes after", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  b.fire("ready");
  const result = controller.present();
  await vi.waitFor(() => expect(b.sent).toHaveLength(1));

  controller.dispose();

  await expect(result).resolves.toBe("closed");
  b.firePresented(sentId(b));
});

it("a present replaced by a later request before the ready report resolves closed", async () => {
  const b = bridge();
  const controller = createThreadsWindowController({ bridge: b });
  let settled: string | undefined;
  void controller.present(CHIP, { thread: "t1" }).then((result) => {
    settled = result;
  });
  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalled());
  controller.open(CHIP);

  await vi.waitFor(() => expect(settled).toBe("closed"));
  b.fire("ready");
  await vi.waitFor(() =>
    expect(b.sent).toEqual([{ chip: { x: 110, y: 70, width: 100, height: 30 } }]),
  );
});
