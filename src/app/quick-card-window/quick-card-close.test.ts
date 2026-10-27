// @vitest-environment jsdom
/**
 * quick-card-close.test.ts — the focus poll that closes the quick card when no YUI window
 * has focus once its window has taken focus, and the hide that follows every close of the card.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getAllWindows, getCurrentWindow, hide } = vi.hoisted(() => {
  const hide = vi.fn(async () => {});
  return {
    hide,
    getCurrentWindow: vi.fn(() => ({ hide })),
    getAllWindows: vi.fn(async (): Promise<Array<{ isFocused(): Promise<boolean> }>> => []),
  };
});
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows, getCurrentWindow }));

import { wireQuickCardClose } from "./quick-card-close";

function fakeCard() {
  const closeCbs = new Set<() => void>();
  return {
    close: vi.fn(() => {
      for (const cb of [...closeCbs]) cb();
    }),
    onClose: (cb: () => void) => {
      closeCbs.add(cb);
      return () => closeCbs.delete(cb);
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

/** The card open and its window just focused: the dock has called watch(). */
function watched() {
  const card = fakeCard();
  const hideWindow = vi.fn(async () => {});
  const control = wireQuickCardClose({ card, hide: hideWindow });
  control.watch();
  return { card, control, hideWindow };
}

it("hides and closes when a tick finds no YUI window focused", async () => {
  const { card, hideWindow } = watched();
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => false }]);

  await vi.advanceTimersByTimeAsync(300);

  expect(card.close).toHaveBeenCalledOnce();
  // The hide rides the card's close edge, not a second call from the poll.
  expect(hideWindow).toHaveBeenCalledOnce();
});

it("does not hide while any YUI window has focus", async () => {
  const { card, hideWindow } = watched();
  getAllWindows.mockImplementation(async () => [
    { isFocused: async () => false },
    { isFocused: async () => true },
  ]);

  await vi.advanceTimersByTimeAsync(900);

  expect(card.close).not.toHaveBeenCalled();
  expect(hideWindow).not.toHaveBeenCalled();
});

it("closes on the first none-focused tick after focus went card → pet window → none", async () => {
  const { card, hideWindow } = watched();
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => true }]);

  await vi.advanceTimersByTimeAsync(300);
  expect(card.close).not.toHaveBeenCalled();

  getAllWindows.mockImplementation(async () => [{ isFocused: async () => false }]);
  await vi.advanceTimersByTimeAsync(300);

  expect(card.close).toHaveBeenCalledOnce();
  expect(hideWindow).toHaveBeenCalledOnce();
});

it("scans only from the window's focus until the card closes", async () => {
  const card = fakeCard();
  const control = wireQuickCardClose({ card, hide: vi.fn(async () => {}) });
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => true }]);

  // Opened, but its window has not taken focus yet: nothing focused must not close it.
  await vi.advanceTimersByTimeAsync(900);
  expect(getAllWindows).not.toHaveBeenCalled();

  control.watch();
  await vi.advanceTimersByTimeAsync(300);
  expect(getAllWindows).toHaveBeenCalledOnce();

  card.close();
  await vi.advanceTimersByTimeAsync(900);
  expect(getAllWindows).toHaveBeenCalledOnce();
});

it("hides the window when the card closes by any other trigger", async () => {
  const { card, hideWindow } = watched();

  card.close();

  expect(hideWindow).toHaveBeenCalledOnce();
});

it("stops polling on dispose", async () => {
  const { control } = watched();

  control.dispose();
  await vi.advanceTimersByTimeAsync(900);

  expect(getAllWindows).not.toHaveBeenCalled();
});
