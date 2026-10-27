// @vitest-environment jsdom
/**
 * quick-card-window.test.ts — how the pet window's quick-card controller creates, reuses and
 * destroys the card window, and holds a request until the window reports ready.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { WebviewWindow, getByLabel } = vi.hoisted(() => ({
  WebviewWindow: vi.fn(
    class {
      once = vi.fn();
      close = vi.fn(async () => {});
    },
  ),
  getByLabel: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Object.assign(WebviewWindow, { getByLabel }),
}));

import { createQuickCardWindowController } from "./quick-card-window";

/** The bridge half the controller talks to, with the ready report under the test's hand. */
function bridge() {
  const readyCbs = new Set<() => void>();
  const sent: unknown[] = [];
  return {
    emitQuickCardOpen: (request: unknown) => void sent.push(request),
    onQuickCardReady: (cb: () => void) => {
      readyCbs.add(cb);
      return () => readyCbs.delete(cb);
    },
    ready: () => {
      for (const cb of [...readyCbs]) cb();
    },
    sent,
  };
}

const REQUEST = { left: 64, right: 336, y: 120 };

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  getByLabel.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  [null, "quick-card", "quick-card.html"],
  ["a", "quick-card-a", "quick-card.html?preset=a"],
])("creates the window once with the card options and reuses it (bound: %s)", async (boundId, label, url) => {
  const b = bridge();
  const controller = createQuickCardWindowController({ boundId, bridge: b });
  controller.open(REQUEST);
  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledTimes(1));
  expect(WebviewWindow).toHaveBeenCalledWith(
    label,
    expect.objectContaining({
      url,
      width: 288,
      height: 120,
      resizable: false,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      visible: false,
      focus: false,
      acceptFirstMouse: true,
    }),
  );

  b.ready();
  const existing = { destroy: vi.fn(async () => {}) };
  getByLabel.mockResolvedValue(existing);
  controller.open({ left: 1, right: 2, y: 3 });
  await vi.waitFor(() => expect(b.sent).toEqual([REQUEST, { left: 1, right: 2, y: 3 }]));
  expect(WebviewWindow).toHaveBeenCalledTimes(1);
  expect(existing.destroy).not.toHaveBeenCalled();
});

it("holds a request made before the ready report and sends it on the report", async () => {
  const b = bridge();
  const controller = createQuickCardWindowController({ boundId: null, bridge: b });
  controller.open(REQUEST);
  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledTimes(1));
  expect(b.sent).toEqual([]);

  b.ready();

  await vi.waitFor(() => expect(b.sent).toEqual([REQUEST]));
});

function leftoverWindow() {
  let destroyed: (() => void) | null = null;
  return {
    close: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    once: vi.fn(async (event: string, cb: () => void) => {
      if (event === "tauri://destroyed") destroyed = cb;
      return () => {};
    }),
    fireDestroyed: () => destroyed?.(),
  };
}

it("destroys a leftover window and creates its own once the old one is gone", async () => {
  const leftover = leftoverWindow();
  getByLabel.mockResolvedValue(leftover);
  const b = bridge();
  const controller = createQuickCardWindowController({ boundId: null, bridge: b });

  controller.open(REQUEST);
  // close() would only request it; destroy() frees the label once the window is gone.
  await vi.waitFor(() => expect(leftover.destroy).toHaveBeenCalledTimes(1));
  expect(leftover.close).not.toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, 20));
  expect(WebviewWindow).not.toHaveBeenCalled();

  leftover.fireDestroyed();
  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledTimes(1));
  b.ready();
  await vi.waitFor(() => expect(b.sent).toEqual([REQUEST]));
});

it("creates its own window after a short wait when the leftover never reports destroyed", async () => {
  const leftover = leftoverWindow();
  getByLabel.mockResolvedValue(leftover);
  const controller = createQuickCardWindowController({ boundId: null, bridge: bridge() });

  controller.open(REQUEST);

  await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledTimes(1), { timeout: 2000 });
});

it("does nothing outside Tauri", async () => {
  vi.unstubAllGlobals();
  const b = bridge();
  const controller = createQuickCardWindowController({ boundId: null, bridge: b });

  controller.open(REQUEST);

  expect(getByLabel).not.toHaveBeenCalled();
  expect(WebviewWindow).not.toHaveBeenCalled();
  expect(b.sent).toEqual([]);
});
