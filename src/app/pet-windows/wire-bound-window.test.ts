// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLogger } from "../../logger";
import { createPetWindows, isPresetWindowLive } from "../../settings/preset/pet-windows";
import { wireBoundWindow } from "./wire-bound-window";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
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
        expect(isPresetWindowLive("a")).toBe(false);
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
    expect(isPresetWindowLive("a")).toBe(true);
    petWindows.close("other");
    expect(calls).toEqual([]);
    petWindows.close("a");
  }
  await vi.waitFor(() => expect(calls).toEqual(["stores", "emit"]));
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

it.each([true, false])("clears live state on pagehide only in browser (Tauri: %s)", (tauri) => {
  if (tauri) vi.stubGlobal("__TAURI_INTERNALS__", {});
  const petWindows = createPetWindows();
  petWindows.open("a");
  const off = wireBoundWindow({
    boundId: "a",
    petWindows,
    bridge: { emitPetWindowsChanged: async () => {} },
    disposeStores: () => {},
    disposeSync: () => {},
    close: () => {},
    log: createLogger("test"),
  });
  window.dispatchEvent(new Event("pagehide"));
  expect(isPresetWindowLive("a")).toBe(tauri);
  off();
});

it("still closes when lifecycle cleanup throws", async () => {
  const close = vi.fn(),
    log = createLogger("test"),
    warn = vi.spyOn(log, "warn");
  wireBoundWindow({
    boundId: "a",
    petWindows: createPetWindows(),
    bridge: { emitPetWindowsChanged: async () => {} },
    disposeStores: () => {},
    disposeSync: () => {
      throw Error("sync teardown");
    },
    close,
    log,
  });
  await vi.waitFor(() => expect(close).toHaveBeenCalledExactlyOnceWith());
  expect(warn).toHaveBeenCalledWith("pet_window_dispose_failed", {
    preset: "a",
    error: "Error: sync teardown",
  });
});

it.each([
  false,
  true,
])("preserves companion deletion guards after timeout or a failed close (failure: %s)", async (failed) => {
  vi.useFakeTimers();
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  localStorage.setItem("yui.live-window.settings-a", "1");
  const calls: string[] = [];
  const log = createLogger("test"),
    warn = vi.spyOn(log, "warn");
  wireBoundWindow({
    boundId: "a",
    petWindows: createPetWindows(),
    bridge: { emitPetWindowsChanged: async () => {} },
    closeCompanions: async () => {
      calls.push("companions");
      if (failed) throw Error("close refused");
    },
    disposeStores: () => {
      calls.push("stores");
    },
    disposeSync: () => {},
    close: () => {
      calls.push("close");
    },
    log,
  });
  expect(calls).toEqual(["companions"]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toEqual(["companions", "stores", "close"]);
  expect(localStorage.getItem("yui.live-window.settings-a")).toBe("1");
  expect(warn).toHaveBeenCalledWith("companion_close_timeout", { preset: "a" });
});
