// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLogger } from "../../logger";
import { createPetWindows, isPetWindowLive } from "../../settings/preset/pet-windows";
import { wireBoundWindow } from "./wire-bound-window";

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());
it.each([
  true,
  false,
])("closes safely when desired is removed (initially open: %s)", async (initiallyOpen) => {
  const petWindows = createPetWindows();
  if (initiallyOpen) petWindows.open("a");
  const calls: string[] = [];
  let sent!: () => void;
  const off = wireBoundWindow({
    boundId: "a",
    petWindows,
    bridge: {
      emitPetWindowsChanged: () => {
        expect(isPetWindowLive("a")).toBe(false);
        calls.push("emit");
        return new Promise<void>((r) => {
          sent = r;
        });
      },
    },
    disposeStores: () => {
      calls.push("stores");
      throw Error("teardown");
    },
    disposeSync: () => calls.push("sync"),
    close: () => {
      calls.push("close");
    },
    log: createLogger("test"),
  });
  if (initiallyOpen) {
    expect(isPetWindowLive("a")).toBe(true);
    petWindows.close("other");
    expect(calls).toEqual([]);
    petWindows.close("a");
  }
  expect(calls).toEqual(["stores", "emit"]);
  sent();
  await vi.waitFor(() => expect(calls).toEqual(["stores", "emit", "sync", "close"]));
  off();
});
it("bounds the final emit at 250 ms", async () => {
  vi.useFakeTimers();
  const petWindows = createPetWindows();
  const close = vi.fn();
  wireBoundWindow({
    boundId: "a",
    petWindows,
    bridge: { emitPetWindowsChanged: () => new Promise(() => {}) },
    disposeStores: () => {},
    disposeSync: () => {},
    close,
    log: createLogger("test"),
  });
  await vi.advanceTimersByTimeAsync(249);
  expect(close).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(close).toHaveBeenCalledTimes(1);
});
