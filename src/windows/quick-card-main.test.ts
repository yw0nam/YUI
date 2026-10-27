// @vitest-environment jsdom
/**
 * quick-card-main.test.ts — the quick-card window boots its wiring: the open request seeds the
 * Listen tile without echoing it back and reaches the dock, which shows the window.
 */

import { afterEach, expect, it, vi } from "vitest";

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

afterEach(async () => {
  petBridge?.dispose();
  petBridge = undefined as never;
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

it("seeds the Listen tile from the open request without echoing it back, and shows the window by her", async () => {
  await boot();
  const voiceSet = vi.fn();
  petBridge.onVoiceSet(voiceSet);

  petBridge.emitQuickCardOpen({ left: 40, right: 360, y: 200, listening: true });
  await vi.waitFor(() => expect(win.show).toHaveBeenCalledOnce());

  // The dock placed it against main's pet window; quick-card-dock.test.ts pins where.
  expect(getByLabel).toHaveBeenCalledWith("main");

  // The Listen tile took the request's flag; the mirror stayed silent.
  const tiles = [...document.querySelectorAll<HTMLElement>(".yui-qcard__tile")];
  expect(tiles[1]!.getAttribute("aria-checked")).toBe("true");
  expect(voiceSet).not.toHaveBeenCalled();
});
