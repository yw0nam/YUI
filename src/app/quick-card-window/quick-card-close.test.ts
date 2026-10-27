// @vitest-environment jsdom
/**
 * quick-card-close.test.ts — the focus poll that closes the quick card when no YUI window
 * has focus, from its window's first focus after the open, and the hide that follows every close.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getAllWindows, getCurrentWindow, focusChanged } = vi.hoisted(() => {
  const focusChanged: Array<(event: { payload: boolean }) => void> = [];
  return {
    focusChanged,
    getCurrentWindow: vi.fn(() => ({
      onFocusChanged: vi.fn(async (cb: (event: { payload: boolean }) => void) => {
        focusChanged.push(cb);
        return () => {};
      }),
    })),
    getAllWindows: vi.fn(async (): Promise<Array<{ isFocused(): Promise<boolean> }>> => []),
  };
});
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows, getCurrentWindow }));

import { wireQuickCardClose } from "./quick-card-close";

function fakeCard() {
  let open = true;
  const closeCbs = new Set<() => void>();
  return {
    isOpen: () => open,
    close: vi.fn(() => {
      open = false;
      for (const cb of [...closeCbs]) cb();
    }),
    onClose: (cb: () => void) => {
      closeCbs.add(cb);
      return () => closeCbs.delete(cb);
    },
  };
}

/** The card's window gains or loses OS focus. */
function windowFocus(focused: boolean): void {
  for (const cb of focusChanged) cb({ payload: focused });
}

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.useFakeTimers();
  focusChanged.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** An open card whose window has just gained focus. */
async function focused() {
  const card = fakeCard();
  const hideWindow = vi.fn(async () => {});
  const control = wireQuickCardClose({ card, hide: hideWindow });
  await vi.waitFor(() => expect(focusChanged).toHaveLength(1));
  windowFocus(true);
  return { card, control, hideWindow };
}

it("hides and closes when a tick finds no YUI window focused", async () => {
  const { card, hideWindow } = await focused();
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => false }]);

  await vi.advanceTimersByTimeAsync(300);

  expect(card.close).toHaveBeenCalledOnce();
  // The hide rides the card's close edge, not a second call from the poll.
  expect(hideWindow).toHaveBeenCalledOnce();
});

it("does not hide while any YUI window has focus", async () => {
  const { card, hideWindow } = await focused();
  getAllWindows.mockImplementation(async () => [
    { isFocused: async () => false },
    { isFocused: async () => true },
  ]);

  await vi.advanceTimersByTimeAsync(900);

  expect(card.close).not.toHaveBeenCalled();
  expect(hideWindow).not.toHaveBeenCalled();
});

it("closes on the first none-focused tick after focus went card → pet window → none", async () => {
  const { card, hideWindow } = await focused();
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => true }]);

  await vi.advanceTimersByTimeAsync(300);
  expect(card.close).not.toHaveBeenCalled();

  getAllWindows.mockImplementation(async () => [{ isFocused: async () => false }]);
  await vi.advanceTimersByTimeAsync(300);

  expect(card.close).toHaveBeenCalledOnce();
  expect(hideWindow).toHaveBeenCalledOnce();
});

it("scans only from its window's first focus until the card closes", async () => {
  const card = fakeCard();
  wireQuickCardClose({ card, hide: vi.fn(async () => {}) });
  await vi.waitFor(() => expect(focusChanged).toHaveLength(1));
  getAllWindows.mockImplementation(async () => [{ isFocused: async () => false }]);

  // Open, but its window never gained focus: only the card's other triggers close it.
  await vi.advanceTimersByTimeAsync(900);
  expect(getAllWindows).not.toHaveBeenCalled();
  expect(card.close).not.toHaveBeenCalled();

  windowFocus(true);
  await vi.advanceTimersByTimeAsync(300);
  expect(card.close).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(900);
  expect(getAllWindows).toHaveBeenCalledOnce();
});

it("hides the window when the card closes by any other trigger", async () => {
  const { card, hideWindow } = await focused();

  card.close();

  expect(hideWindow).toHaveBeenCalledOnce();
});

it("stops polling on dispose", async () => {
  const { control } = await focused();

  control.dispose();
  await vi.advanceTimersByTimeAsync(900);

  expect(getAllWindows).not.toHaveBeenCalled();
});
