/** The Character menu window: created hidden once at main's boot, replacing a leftover one; every pet window's menu draws in it. */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import { destroyAndWait } from "./ready-window";

const log = createLogger("character-menu-window");

/** The Character menu window's label. */
export const CHARACTER_MENU_WINDOW_LABEL = "character-menu";

export async function createCharacterMenuWindow(): Promise<void> {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const leftover = await WebviewWindow.getByLabel(CHARACTER_MENU_WINDOW_LABEL);
  if (leftover) await destroyAndWait(leftover, CHARACTER_MENU_WINDOW_LABEL);
  const win = new WebviewWindow(CHARACTER_MENU_WINDOW_LABEL, {
    url: "character-menu.html",
    title: "YUI",
    resizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    visible: false,
    focus: false,
    // The first click into the unfocused window lands as well as focusing it (macOS).
    acceptFirstMouse: true,
  });
  void win.once("tauri://error", (event) => {
    log.error("character_menu_window_create_error", { error: String(event) });
  });
}
