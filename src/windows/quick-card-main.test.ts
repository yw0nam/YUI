// @vitest-environment jsdom
/**
 * quick-card-main.test.ts — the quick-card window boots its wiring: the open request seeds the
 * Listen tile without echoing it back, and the dock places the window beside the character.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../styles.css", () => ({}));
vi.mock("../ui/quick-card/quick-card.css", () => ({}));
vi.mock("../ui/unified/avatar.css", () => ({}));

const { win, getCurrentWindow, availableMonitors, primaryMonitor, getAllWindows } = vi.hoisted(
  () => {
    const win = {
      setSize: vi.fn(async (_arg: unknown) => {}),
      setPosition: vi.fn(async (_arg: unknown) => {}),
      show: vi.fn(async () => {}),
      setFocus: vi.fn(async () => {}),
      setTheme: vi.fn(async () => {}),
      startDragging: vi.fn(async () => {}),
      outerPosition: vi.fn(async () => ({ x: 1000, y: 200 })),
      scaleFactor: vi.fn(async () => 1),
      onMoved: vi.fn(() => () => {}),
      hide: vi.fn(async () => {}),
    };
    return {
      win,
      getCurrentWindow: vi.fn(() => win),
      availableMonitors: vi.fn(async () => [MONITOR]),
      primaryMonitor: vi.fn(async () => MONITOR),
      getAllWindows: vi.fn(async () => [{ isFocused: async () => true }]),
    };
  },
);

const { getByLabel } = vi.hoisted(() => {
  const owner = {
    outerPosition: vi.fn(async () => ({ x: 500, y: 300 })),
    outerSize: vi.fn(async () => ({ width: 400, height: 600 })),
    scaleFactor: vi.fn(async () => 1),
    onMoved: vi.fn(() => () => {}),
  };
  return { owner, getByLabel: vi.fn(async () => owner) };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow,
  availableMonitors,
  primaryMonitor,
  getAllWindows,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel },
}));

const MONITOR = {
  position: { x: 0, y: 0 },
  size: { width: 2000, height: 1000 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 1000 } },
  scaleFactor: 1,
};

import { createSettingsBridge, type SettingsBridge } from "../io/bridge/settings-bridge";

let petBridge: SettingsBridge;

beforeEach(() => {
  // jsdom has no layout: the card measures 272×400 like the stylesheet says.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    get: () => 272,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    get: () => 400,
    configurable: true,
  });
});

afterEach(async () => {
  petBridge?.dispose();
  petBridge = undefined as never;
  delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth;
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
  document.body.innerHTML = "";
});

async function boot(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  petBridge = createSettingsBridge(undefined, { windowKind: "pet" });
  const ready = vi.fn();
  petBridge.onQuickCardReady(ready);
  await import("./quick-card-main");
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
}

it("seeds the Listen tile from the open request without echoing it back, and docks beside her", async () => {
  await boot();
  const voiceSet = vi.fn();
  petBridge.onVoiceSet(voiceSet);

  petBridge.emitQuickCardOpen({ left: 40, right: 360, y: 200, listening: true });
  await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());

  // Docked 12px right of her roomier side: her right edge 860 (owner 500 + right 360),
  // window x 860 + 12 − 8, top = click 500 − 24 − 8, box = card 272×400 + 8px margin.
  expect(win.setSize.mock.calls[0][0]).toMatchObject({ width: 288, height: 416 });
  expect(win.setPosition.mock.calls[0][0]).toMatchObject({ x: 864, y: 468 });
  expect(win.setFocus).toHaveBeenCalledOnce();
  expect(getByLabel).toHaveBeenCalledWith("main");

  // The Listen tile took the request's flag; the mirror stayed silent.
  const tiles = [...document.querySelectorAll<HTMLElement>(".yui-qcard__tile")];
  expect(tiles[1]!.getAttribute("aria-checked")).toBe("true");
  expect(voiceSet).not.toHaveBeenCalled();
});
