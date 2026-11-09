/** Wires the Threads window: the store's snapshots into the view, the view's Answers to the store, the Terminal tab, the Thread turns menu, its frame, open and close, theme and language. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSettingsBridge } from "../../io/bridge/settings-bridge";
import { createThreadsClient } from "../../io/threads/threads-client";
import { createLogger } from "../../logger";
import {
  createTextSizeSettings,
  localStorageTextSizeStorage,
} from "../../settings/appearance/text-size-settings";
import {
  createThemeSettings,
  localStorageThemeStorage,
} from "../../settings/appearance/theme-settings";
import {
  createAgentNotifySettings,
  localStorageAgentNotifyStorage,
} from "../../settings/backend/agent-notify-settings";
import {
  createThreadTurnsSettings,
  localStorageThreadTurnsStorage,
} from "../../settings/threads/thread-turns-settings";
import {
  createThreadsWindowSettings,
  localStorageThreadsWindowStorage,
} from "../../settings/threads/threads-window-settings";
import { isTauri } from "../../tauri-env";
import { reloadFromStorage as reloadLocale } from "../../ui/i18n";
import { applyTextScale } from "../../ui/theme/apply-text-scale";
import { applyTheme } from "../../ui/theme/apply-theme";
import { createThreadsView } from "../../ui/threads/window/threads-view";
import type { Disposers } from "../disposers";
import { createThreadsPlacement } from "./threads-placement";
import { createThreadsPresence } from "./threads-presence";
import { createThreadsResize } from "./threads-resize";
import { wireTerminalTab } from "./wire-terminal-tab";
import { wireTurnsMenu } from "./wire-turns-menu";

const log = createLogger("wire-threads-window");

export async function wireThreadsWindow(deps: {
  app: HTMLElement;
  lifecycle: Disposers;
}): Promise<void> {
  const { register } = deps.lifecycle;
  const themeSettings = createThemeSettings({ storage: localStorageThemeStorage() });
  const textSizeSettings = createTextSizeSettings({ storage: localStorageTextSizeStorage() });
  const threadTurnsSettings = createThreadTurnsSettings({
    storage: localStorageThreadTurnsStorage(),
  });
  const agentNotifySettings = createAgentNotifySettings({
    storage: localStorageAgentNotifyStorage(),
  });
  const bridge = createSettingsBridge(undefined, { windowKind: "threads" });
  const turnsMenu = wireTurnsMenu({
    turns: threadTurnsSettings,
    agentNotify: agentNotifySettings,
    emitSettingsChanged: bridge.emitSettingsChanged,
  });
  const client = createThreadsClient();
  const settings = createThreadsWindowSettings({ storage: localStorageThreadsWindowStorage() });
  const placement = createThreadsPlacement({ settings });
  const resize = createThreadsResize({
    current: placement.current,
    apply: placement.apply,
    save: placement.save,
    nextFrame: (cb) => requestAnimationFrame(cb),
  });
  const view = createThreadsView({
    mount: deps.app,
    now: Date.now,
    onAnswer: client.answer,
    onSeen: (id, askId) =>
      void client
        .seen(id, askId)
        .catch((error) => log.warn("thread_seen_failed", { error: String(error) })),
    onRead: (id) =>
      void client
        .read(id)
        .catch((error) => log.warn("thread_read_failed", { error: String(error) })),
    onClose: () => presence.close(),
    listCollapsed: settings.get().listCollapsed,
    onListCollapsed: settings.setListCollapsed,
    listWidth: settings.get().listWidth ?? null,
    onListWidth: settings.setListWidth,
    resize,
    terminal: wireTerminalTab({ register, settings }),
    onTurnsLevel: turnsMenu.pick,
  });
  const presence = createThreadsPresence({
    view,
    show: placement.open,
    focus: placement.focus,
    raise: placement.raise,
    hide: placement.hide,
    emitClosed: bridge.emitThreadsClosed,
    emitPresented: (present) => bridge.emitThreadsPresented({ present }),
  });

  // Drains LIFO, so registered in reverse of the teardown order.
  register(() => themeSettings.dispose());
  register(() => textSizeSettings.dispose());
  register(() => threadTurnsSettings.dispose());
  register(() => agentNotifySettings.dispose());
  register(() => bridge.dispose());
  register(() => client.dispose());
  register(() => view.dispose());
  register(turnsMenu.draw(view.setTurns));
  register(() => placement.dispose());
  register(
    applyTheme({
      store: themeSettings,
      root: document.documentElement,
      setNativeTheme: isTauri() ? (theme) => getCurrentWindow().setTheme(theme) : undefined,
    }),
  );
  register(applyTextScale({ store: textSizeSettings, root: document.documentElement }));
  register(client.subscribe(view.update));
  register(view.onHeadPointerDown(placement.startDrag));
  register(
    bridge.onThreadsOpen(({ chip, tab, thread, focus, present }) =>
      presence.open(chip, tab, { thread, focus, present }),
    ),
  );
  register(
    bridge.onSettingsChanged(() => {
      reloadLocale();
      themeSettings.reloadFromStorage();
      textSizeSettings.reloadFromStorage();
      threadTurnsSettings.reloadFromStorage();
      agentNotifySettings.reloadFromStorage();
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
