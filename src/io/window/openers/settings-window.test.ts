// @vitest-environment jsdom
/**
 * settings-window.test.ts — pop-out settings window opener + cross-window sync.
 *
 * Pins the contract for src/io/window/openers/settings-window.ts:
 *   openSettingsWindow(env) routes Tauri vs browser (pure, injectable)
 *   titleSettingsWindow(title) sets the document title, plus the native one under Tauri
 *   wireStorageSync(stores) re-reads every store on a `storage` event; disposer detaches.
 *
 * The real factory createSettingsWindowOpener() wires WebviewWindow / window.open — pinned here are
 * its creation-time title (English while the document title follows the app language), the URL a
 * requested page puts on a new window, and the page request an open window is sent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { WebviewWindow, setTitle, log } = vi.hoisted(() => ({
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
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle }) }));
vi.mock("../../../logger", () => ({ createLogger: () => log }));

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

  it.each([
    ["hearth", [17, 12, 7]],
    ["dawn", [249, 246, 242]],
  ])("creates the Tauri window with an English title on the %s panel colour", async (theme, rgb) => {
    const globals = globalThis as { __TAURI_INTERNALS__?: unknown };
    globals.__TAURI_INTERNALS__ = {};
    document.documentElement.dataset.theme = theme;
    try {
      createSettingsWindowOpener(undefined, vi.fn())();
      await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledOnce());
      expect(WebviewWindow).toHaveBeenCalledWith(
        "settings",
        expect.objectContaining({ title: "YUI Settings", backgroundColor: rgb }),
      );
    } finally {
      delete globals.__TAURI_INTERNALS__;
      delete document.documentElement.dataset.theme;
    }
  });

  it("logs settings_window_closed when the created window is destroyed, not before", async () => {
    const globals = globalThis as { __TAURI_INTERNALS__?: unknown };
    globals.__TAURI_INTERNALS__ = {};
    try {
      createSettingsWindowOpener(undefined, vi.fn())();
      await vi.waitFor(() => expect(WebviewWindow).toHaveBeenCalledOnce());
      const win = vi.mocked(WebviewWindow).mock.instances[0] as unknown as {
        once: ReturnType<typeof vi.fn>;
      };
      const destroyed = win.once.mock.calls.find(([event]) => event === "tauri://destroyed");
      expect(log.info).not.toHaveBeenCalledWith("settings_window_closed", expect.anything());

      destroyed?.[1]();

      expect(log.info).toHaveBeenCalledWith("settings_window_closed", { label: "settings" });
    } finally {
      delete globals.__TAURI_INTERNALS__;
    }
  });

  it("creates and reuses the bound settings singleton", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    try {
      createSettingsWindowOpener("a", vi.fn())();
      await vi.waitFor(() =>
        expect(WebviewWindow).toHaveBeenCalledWith(
          "settings-a",
          expect.objectContaining({ url: "settings.html?preset=a" }),
        ),
      );
      const show = vi.fn(async () => {}),
        setFocus = vi.fn(async () => {});
      WebviewWindow.getByLabel.mockResolvedValue({ show, setFocus } as never);
      createSettingsWindowOpener("a", vi.fn())();
      await vi.waitFor(() => expect(setFocus).toHaveBeenCalledTimes(1));
      expect(WebviewWindow).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createSettingsWindowOpener — page request
// ─────────────────────────────────────────────────────────────────────────────

describe("createSettingsWindowOpener page request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    [undefined, "conn", "settings.html?page=conn"],
    ["a", "hist", "settings.html?preset=a&page=hist"],
    [undefined, undefined, "settings.html"],
  ] as const)("creates the Tauri window for %s on page %s at %s", async (boundId, page, url) => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const emit = vi.fn();

    createSettingsWindowOpener(boundId, emit)(page);

    await vi.waitFor(() =>
      expect(WebviewWindow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ url }),
      ),
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "general", "/settings.html?page=general"],
    ["a", "conn", "/settings.html?preset=a&page=conn"],
  ] as const)("opens the browser window for %s on page %s at %s", (boundId, page, url) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    createSettingsWindowOpener(boundId, vi.fn())(page);

    expect(open).toHaveBeenCalledWith(url, expect.any(String), "width=760,height=680");
  });

  it.each([
    [null, "conn", { preset: null, page: "conn" }],
    ["a", "hist", { preset: "a", page: "hist" }],
    ["a", undefined, { preset: "a" }],
  ] as const)("an open window of %s is asked for page %s with %j after it is focused", async (boundId, page, request) => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const order: string[] = [];
    const show = vi.fn(async () => void order.push("show"));
    const setFocus = vi.fn(async () => void order.push("focus"));
    WebviewWindow.getByLabel.mockResolvedValue({ show, setFocus } as never);
    const emit = vi.fn(() => void order.push("emit"));

    createSettingsWindowOpener(boundId, emit)(page);

    await vi.waitFor(() => expect(emit).toHaveBeenCalledExactlyOnceWith(request));
    expect(order).toEqual(["show", "focus", "emit"]);
    expect(WebviewWindow).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// titleSettingsWindow — document title + native title
// ─────────────────────────────────────────────────────────────────────────────

describe("titleSettingsWindow", () => {
  const globals = globalThis as { __TAURI_INTERNALS__?: unknown };

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
