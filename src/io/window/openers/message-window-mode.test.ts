// @vitest-environment jsdom
/**
 * message-window-mode.test.ts — the pet side of the mode.
 *
 * Keeps the message window's existence in step with the stored mode, the dock
 * request raised from its plate, and the tray's show/hide of the character.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  createMessageWindowSettings,
  type MessageWindowSettingsStore,
} from "../../../settings/panels/message-window-settings";
import { wireMessageWindowMode } from "./message-window-mode";

describe("wireMessageWindowMode", () => {
  let store: MessageWindowSettingsStore;
  let messageWindow: { open: Mock<() => void>; hide: Mock<() => void> };
  let dockHandlers: Array<() => void>;
  let trayHandlers: Array<(visible: boolean) => void>;
  let shown: boolean;
  let shownHandlers: Array<(shown: boolean) => void>;

  const wire = (): (() => void) =>
    wireMessageWindowMode({
      store,
      remote: {
        onDock: (cb) => {
          dockHandlers.push(cb);
        },
      },
      window: messageWindow,
      listenTrayToggle: (cb) => {
        trayHandlers.push(cb);
        return () => {
          trayHandlers = trayHandlers.filter((h) => h !== cb);
        };
      },
      shown: {
        subscribe: (cb) => {
          shownHandlers.push(cb);
          return () => {
            shownHandlers = shownHandlers.filter((h) => h !== cb);
          };
        },
      },
      getMode: () => (shown ? "docked" : store.get().mode),
    });
  const setShown = (next: boolean): void => {
    shown = next;
    for (const cb of shownHandlers) cb(next);
  };

  beforeEach(() => {
    store = createMessageWindowSettings();
    messageWindow = { open: vi.fn<() => void>(), hide: vi.fn<() => void>() };
    dockHandlers = [];
    trayHandlers = [];
    shown = false;
    shownHandlers = [];
  });

  it("hides a popped window while the unified window shows, and shows it again after", () => {
    store.setMode("popped");
    wire();
    messageWindow.open.mockClear();

    setShown(true);
    expect(messageWindow.hide).toHaveBeenCalledTimes(1);
    expect(store.get().mode).toBe("popped");

    setShown(false);
    expect(messageWindow.open).toHaveBeenCalledTimes(1);
  });

  it("hides the window at boot when the stored mode is docked", () => {
    wire();
    expect(messageWindow.hide).toHaveBeenCalledTimes(1);
    expect(messageWindow.open).not.toHaveBeenCalled();
  });

  it("opens the window at boot when the stored mode is popped", () => {
    store.setMode("popped");
    wire();
    expect(messageWindow.open).toHaveBeenCalledTimes(1);
  });

  it("opens and hides the window as the mode changes", () => {
    wire();
    messageWindow.hide.mockClear();

    store.setMode("popped");
    expect(messageWindow.open).toHaveBeenCalledTimes(1);

    store.setMode("docked");
    expect(messageWindow.hide).toHaveBeenCalledTimes(1);
  });

  it("docks on the request raised from the window's plate", () => {
    store.setMode("popped");
    wire();

    for (const cb of dockHandlers) cb();

    expect(store.get().mode).toBe("docked");
    expect(messageWindow.hide).toHaveBeenCalled();
  });

  it("follows the character out of sight and back when the tray toggles", () => {
    store.setMode("popped");
    wire();
    messageWindow.open.mockClear();

    for (const cb of trayHandlers) cb(false);
    expect(messageWindow.hide).toHaveBeenCalledTimes(1);

    for (const cb of trayHandlers) cb(true);
    expect(messageWindow.open).toHaveBeenCalledTimes(1);
  });

  it("leaves the window hidden when the tray shows a character in docked mode", () => {
    wire();
    messageWindow.hide.mockClear();

    for (const cb of trayHandlers) cb(true);

    expect(messageWindow.open).not.toHaveBeenCalled();
    expect(messageWindow.hide).toHaveBeenCalledTimes(1);
  });

  it("stops following the store and the tray once disposed", () => {
    const dispose = wire();
    dispose();
    messageWindow.open.mockClear();
    messageWindow.hide.mockClear();

    store.setMode("popped");
    for (const cb of trayHandlers) cb(false);

    expect(messageWindow.open).not.toHaveBeenCalled();
    expect(messageWindow.hide).not.toHaveBeenCalled();
    expect(trayHandlers).toHaveLength(0);
  });
});
