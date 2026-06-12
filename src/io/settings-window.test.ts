// @vitest-environment jsdom
/**
 * settings-window.test.ts — TDD red for the pop-out settings window opener + cross-window sync.
 *
 * Pins the contract for src/io/settings-window.ts:
 *   openSettingsWindow(env) routes Tauri vs browser (pure, injectable)
 *   wireStorageSync(stores) re-reads every store on a `storage` event; disposer detaches.
 *
 * The real factory createSettingsWindowOpener() wires WebviewWindow / window.open — that's
 * integration (dynamic import in the Tauri branch) and is intentionally not unit-tested here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { openSettingsWindow, type SettingsWindowEnv, wireStorageSync } from "./settings-window";

// ─────────────────────────────────────────────────────────────────────────────
// openSettingsWindow — routing
// ─────────────────────────────────────────────────────────────────────────────

describe("openSettingsWindow", () => {
  it("routes to createTauriWindow when isTauri is true", () => {
    const createTauriWindow = vi.fn();
    const openBrowserWindow = vi.fn();
    const env: SettingsWindowEnv = { isTauri: true, createTauriWindow, openBrowserWindow };

    openSettingsWindow(env);

    expect(createTauriWindow).toHaveBeenCalledOnce();
    expect(openBrowserWindow).not.toHaveBeenCalled();
  });

  it("routes to openBrowserWindow when isTauri is false", () => {
    const createTauriWindow = vi.fn();
    const openBrowserWindow = vi.fn();
    const env: SettingsWindowEnv = { isTauri: false, createTauriWindow, openBrowserWindow };

    openSettingsWindow(env);

    expect(openBrowserWindow).toHaveBeenCalledOnce();
    expect(createTauriWindow).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wireStorageSync — cross-window store resync
// ─────────────────────────────────────────────────────────────────────────────

describe("wireStorageSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls reloadFromStorage on every store when a storage event fires", () => {
    const a = { reloadFromStorage: vi.fn() };
    const b = { reloadFromStorage: vi.fn() };

    const dispose = wireStorageSync([a, b]);
    window.dispatchEvent(new StorageEvent("storage"));

    expect(a.reloadFromStorage).toHaveBeenCalledOnce();
    expect(b.reloadFromStorage).toHaveBeenCalledOnce();

    dispose();
  });

  it("disposer removes the listener — later events do not call reloadFromStorage", () => {
    const a = { reloadFromStorage: vi.fn() };

    const dispose = wireStorageSync([a]);
    dispose();
    window.dispatchEvent(new StorageEvent("storage"));

    expect(a.reloadFromStorage).not.toHaveBeenCalled();
  });

  it("registers a 'storage' listener on window", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const dispose = wireStorageSync([{ reloadFromStorage: vi.fn() }]);
    expect(addSpy).toHaveBeenCalledWith("storage", expect.any(Function));
    dispose();
  });

  it("does not throw with an empty store list", () => {
    const dispose = wireStorageSync([]);
    expect(() => window.dispatchEvent(new StorageEvent("storage"))).not.toThrow();
    dispose();
  });
});
