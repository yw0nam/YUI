// @vitest-environment jsdom
/**
 * settings-window.test.ts — pop-out settings window opener + cross-window sync.
 *
 * Pins the contract for src/io/window/settings-window.ts:
 *   openSettingsWindow(env) routes Tauri vs browser (pure, injectable)
 *   titleSettingsWindow(title) sets the document title, plus the native one under Tauri
 *   wireStorageSync(stores) re-reads every store on a `storage` event; disposer detaches.
 *
 * The real factory createSettingsWindowOpener() wires WebviewWindow / window.open — only its
 * creation-time title is pinned here, since that title stays English while the document title
 * follows the app language.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { WebviewWindow, setTitle } = vi.hoisted(() => ({
  // A class, not an arrow: the production code reaches this mock through `new`.
  WebviewWindow: Object.assign(
    vi.fn(
      class {
        once = vi.fn();
      },
    ),
    { getByLabel: vi.fn(async () => null) },
  ),
  setTitle: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle }) }));

import {
  createSettingsWindowOpener,
  openSettingsWindow,
  type SettingsWindowEnv,
  titleSettingsWindow,
  wireStorageSync,
} from "./settings-window";

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

  it("creates the Tauri window with an English title", async () => {
    const globals = globalThis as { __TAURI_INTERNALS__?: unknown };
    globals.__TAURI_INTERNALS__ = {};
    try {
      createSettingsWindowOpener()();
      await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledOnce());
      expect(WebviewWindow).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({ title: "YUI Settings" }),
      );
    } finally {
      delete globals.__TAURI_INTERNALS__;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// titleSettingsWindow — document title + native title
// ─────────────────────────────────────────────────────────────────────────────

describe("titleSettingsWindow", () => {
  const globals = globalThis as { __TAURI_INTERNALS__?: unknown };

  beforeEach(() => {
    setTitle.mockClear();
  });

  afterEach(() => {
    delete globals.__TAURI_INTERNALS__;
  });

  it("sets the document title and the native title under Tauri", async () => {
    globals.__TAURI_INTERNALS__ = {};

    titleSettingsWindow("YUI 설정");

    expect(document.title).toBe("YUI 설정");
    await vi.waitFor(() => expect(setTitle).toHaveBeenCalledWith("YUI 설정"));
  });

  it("sets only the document title outside Tauri", async () => {
    titleSettingsWindow("YUI Settings");

    expect(document.title).toBe("YUI Settings");
    await Promise.resolve();
    expect(setTitle).not.toHaveBeenCalled();
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
