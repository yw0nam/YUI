/** Wires the Character menu window: its open sessions fed from the pet windows' requests, its theme and language. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import {
  createTextSizeSettings,
  localStorageTextSizeStorage,
} from "../../settings/appearance/text-size-settings";
import {
  createThemeSettings,
  localStorageThemeStorage,
} from "../../settings/appearance/theme-settings";
import { isTauri } from "../../tauri-env";
import { reloadFromStorage as reloadLocale } from "../../ui/i18n";
import { applyTextScale } from "../../ui/theme/apply-text-scale";
import { applyTheme } from "../../ui/theme/apply-theme";
import type { Disposers } from "../disposers";
import { type CharacterMenuWindow, createMenuWindowSession } from "./menu-window-session";

const log = createLogger("wire-character-menu-window");

export async function wireCharacterMenuWindow(deps: {
  app: HTMLElement;
  lifecycle: Disposers;
  bridge: Pick<
    SettingsBridge,
    "emitCharacterMenu" | "onCharacterMenu" | "onSettingsChanged" | "listening" | "dispose"
  >;
  win: CharacterMenuWindow;
}): Promise<void> {
  const { register } = deps.lifecycle;
  const { bridge, win } = deps;
  const themeSettings = createThemeSettings({ storage: localStorageThemeStorage() });
  const textSizeSettings = createTextSizeSettings({ storage: localStorageTextSizeStorage() });
  const box = document.createElement("div");
  box.className = "yui-cmenu-box";
  deps.app.appendChild(box);
  const session = createMenuWindowSession({ mount: box, win, emit: bridge.emitCharacterMenu });

  register(() => themeSettings.dispose());
  register(() => textSizeSettings.dispose());
  register(() => bridge.dispose());
  register(() => session.dispose());
  register(
    applyTheme({
      store: themeSettings,
      root: document.documentElement,
      setNativeTheme: isTauri() ? (theme) => getCurrentWindow().setTheme(theme) : undefined,
    }),
  );
  register(applyTextScale({ store: textSizeSettings, root: document.documentElement }));
  register(
    bridge.onSettingsChanged(() => {
      reloadLocale();
      themeSettings.reloadFromStorage();
      textSizeSettings.reloadFromStorage();
    }),
  );
  window.addEventListener("beforeunload", deps.lifecycle.dispose);

  // A reload while the window showed would leave it shown with no menu in it.
  await win.hide().catch((err) => log.warn("boot_hide_failed", { error: String(err) }));
  register(await win.onBlur(session.blur));
  register(bridge.onCharacterMenu(session.receive));
  await bridge.listening();
}
