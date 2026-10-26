import { afterEach, describe, expect, it, vi } from "vitest";

const { WebviewWindow, getByLabel } = vi.hoisted(() => ({
  WebviewWindow: vi.fn(
    class {
      once = vi.fn();
    },
  ),
  getByLabel: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Object.assign(WebviewWindow, { getByLabel }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    outerPosition: async () => ({ x: 1, y: 2 }),
    outerSize: async () => ({ width: 400, height: 600 }),
    scaleFactor: async () => 1,
  }),
  availableMonitors: async () => [],
}));

import {
  closeUnifiedWindow,
  createUnifiedWindowController,
  openUnifiedWindow,
} from "./unified-window";

afterEach(() => vi.unstubAllGlobals());

describe("createUnifiedWindowController", () => {
  it("creates the window taking the click that activates it", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    createUnifiedWindowController({
      get: () => ({ x: null, y: null }) as never,
      reloadFromStorage() {},
    }).open();
    await vi.waitFor(() =>
      expect(WebviewWindow).toHaveBeenCalledWith(
        "unified",
        expect.objectContaining({ url: "unified.html", acceptFirstMouse: true }),
      ),
    );
  });
});

describe("openUnifiedWindow", () => {
  it("shows and focuses the window that exists instead of creating another", async () => {
    const existing = { show: vi.fn(async () => {}), setFocus: vi.fn(async () => {}) };
    const create = vi.fn(async () => {});

    await openUnifiedWindow({ isTauri: true, getExisting: async () => existing, create });

    expect(existing.show).toHaveBeenCalledOnce();
    expect(existing.setFocus).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the window when none exists", async () => {
    const create = vi.fn(async () => {});

    await openUnifiedWindow({ isTauri: true, getExisting: async () => null, create });

    expect(create).toHaveBeenCalledOnce();
  });

  it("does nothing outside Tauri", async () => {
    const getExisting = vi.fn(async () => null);
    const create = vi.fn(async () => {});

    await openUnifiedWindow({ isTauri: false, getExisting, create });

    expect(getExisting).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("closeUnifiedWindow", () => {
  it("destroys the window, so no close request reaches the window's own close handler", async () => {
    const existing = { destroy: vi.fn(async () => {}), close: vi.fn(async () => {}) };

    await closeUnifiedWindow({ getExisting: async () => existing });

    expect(existing.destroy).toHaveBeenCalledOnce();
    expect(existing.close).not.toHaveBeenCalled();
  });
});
