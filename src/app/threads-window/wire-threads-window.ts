/** Wires the Threads window: the store's snapshots into the view, the view's Answers to the store, its frame, open and close, theme and language. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSettingsBridge } from "../../io/bridge/settings-bridge";
import { createThreadsClient } from "../../io/threads/threads-client";
import { createLogger } from "../../logger";
import {
  createThemeSettings,
  localStorageThemeStorage,
} from "../../settings/appearance/theme-settings";
import {
  createThreadsWindowSettings,
  localStorageThreadsWindowStorage,
} from "../../settings/threads/threads-window-settings";
import { isTauri } from "../../tauri-env";
import { reloadFromStorage as reloadLocale } from "../../ui/i18n";
import { applyTheme } from "../../ui/theme/apply-theme";
import { createThreadsView } from "../../ui/threads/window/threads-view";
import type { Disposers } from "../disposers";
import { createThreadsPlacement } from "./threads-placement";
import { createThreadsPresence } from "./threads-presence";
import { createThreadsResize } from "./threads-resize";

const log = createLogger("wire-threads-window");

export async function wireThreadsWindow(deps: {
  app: HTMLElement;
  lifecycle: Disposers;
}): Promise<void> {
  const { register } = deps.lifecycle;
  const themeSettings = createThemeSettings({ storage: localStorageThemeStorage() });
  const bridge = createSettingsBridge(undefined, { windowKind: "threads" });
  const client = createThreadsClient();
  const settings = createThreadsWindowSettings({ storage: localStorageThreadsWindowStorage() });
  const view = createThreadsView({
    mount: deps.app,
    now: Date.now,
    onAnswer: client.answer,
    onClose: () => presence.close(),
    listCollapsed: settings.get().listCollapsed,
    onListCollapsed: settings.setListCollapsed,
    resize: {
      start: () => resize.start(),
      move: (edge, dx, dy) => resize.move(edge, dx, dy),
      end: () => void resize.end(),
    },
  });
  const placement = createThreadsPlacement({ settings });
  const resize = createThreadsResize({
    current: placement.current,
    apply: placement.apply,
    save: placement.save,
    nextFrame: (cb) => requestAnimationFrame(cb),
  });
  const presence = createThreadsPresence({
    view,
    show: placement.open,
    focus: placement.focus,
    hide: placement.hide,
    emitClosed: bridge.emitThreadsClosed,
  });

  // Drains LIFO, so registered in reverse of the teardown order.
  register(() => themeSettings.dispose());
  register(() => bridge.dispose());
  register(() => client.dispose());
  register(() => view.dispose());
  register(() => placement.dispose());
  register(
    applyTheme({
      store: themeSettings,
      root: document.documentElement,
      setNativeTheme: isTauri() ? (theme) => getCurrentWindow().setTheme(theme) : undefined,
    }),
  );
  register(client.subscribe(view.update));
  register(view.onHeadPointerDown(placement.startDrag));
  register(bridge.onThreadsOpen(({ chip }) => presence.open(chip)));
  register(
    bridge.onSettingsChanged(() => {
      reloadLocale();
      themeSettings.reloadFromStorage();
    }),
  );
  window.addEventListener("beforeunload", deps.lifecycle.dispose);

  // A reload while the window showed would leave it shown with nothing open in it.
  if (isTauri()) {
    await placement
      .hide()
      .catch((error) => log.warn("threads_boot_hide_failed", { error: String(error) }));
  }
  bridge.emitThreadsReady();
}
