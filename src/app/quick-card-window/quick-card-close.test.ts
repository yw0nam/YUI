// @vitest-environment jsdom
/**
 * quick-card-close.test.ts — the focus poll that closes the quick card when no YUI window
 * has focus, and the hide that follows every close of the card.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getAllWindows, getCurrentWindow, hide } = vi.hoisted(() => {
  const hide = vi.fn(async () => {});
  return {
    hide,
    getCurrentWindow: vi.fn(() => ({ hide })),
    getAllWindows: vi.fn(async () => []),
  };
});
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows, getCurrentWindow }));

import { wireQuickCardClose } from "./quick-card-close";

function fakeCard() {
  let open = false;
  const closeCbs = new Set<() => void>();
  return {
    isOpen: vi.fn(() => open),
    close: vi.fn(() => {
      open = false;
      for (const cb of [...closeCbs]) cb();
    }),
    onClose: (cb: () => void) => {
      closeCbs.add(cb);
      return () => closeCbs.delete(cb);
    },
    setOpen(next: boolean) {
      open = next;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.useFakeTimers();
  hide.mockClear();
  getAllWindows.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function wired(card: ReturnType<typeof fakeCard>) {
  const hideWindow = vi.fn(async () => {});
  const control = wireQuickCardClose({ card, hide: hideWindow });
  return { control, hideWindow };
}

it("hides and closes when a tick finds no YUI window focused", async () => {
  const card = fakeCard();
  card.setOpen(true);
  const { hideWindow } = wired(card);
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => false }]);

  await vi.advanceTimersByTimeAsync(300);

  expect(card.close).toHaveBeenCalledOnce();
  expect(hideWindow).toHaveBeenCalledOnce();
  expect(hide).toHaveBeenCalledOnce();
});

it("does not hide while any YUI window has focus", async () => {
  const card = fakeCard();
  card.setOpen(true);
  const { hideWindow } = wired(card);
  getAllWindows.mockImplementation(async () => [
    { isFocused: async () => false },
    { isFocused: async () => true },
  ]);

  await vi.advanceTimersByTimeAsync(900);

  expect(card.close).not.toHaveBeenCalled();
  expect(hideWindow).not.toHaveBeenCalled();
});

it("closes on the first none-focused tick after focus went card → pet window → none", async () => {
  const card = fakeCard();
  card.setOpen(true);
  const { hideWindow } = wired(card);
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => true }]);

  await vi.advanceTimersByTimeAsync(300);
  expect(card.close).not.toHaveBeenCalled();

  getAllWindows.mockImplementation(async () => [{ isFocused: async () => false }]);
  await vi.advanceTimersByTimeAsync(300);

  expect(card.close).toHaveBeenCalledOnce();
  expect(hideWindow).toHaveBeenCalledOnce();
});

it("skips the focus scan while the card is closed", async () => {
  const card = fakeCard();
  wired(card);

  await vi.advanceTimersByTimeAsync(900);

  expect(getAllWindows).not.toHaveBeenCalled();
});

it("hides the window when the card closes by any other trigger", async () => {
  const card = fakeCard();
  card.setOpen(true);
  const { hideWindow } = wired(card);

  card.close();

  expect(hideWindow).toHaveBeenCalledOnce();
});

it("stops polling on dispose", async () => {
  const card = fakeCard();
  card.setOpen(true);
  const { control } = wired(card);

  control.dispose();
  await vi.advanceTimersByTimeAsync(900);

  expect(getAllWindows).not.toHaveBeenCalled();
});
