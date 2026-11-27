/** Wires the Character menu window: each pet window's open placed and shown around her, its picks sent back to that pet window, its theme and language. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HitTestKnobs } from "../../config/validators/avatar/types";
import type { ScreenRect } from "../../contract";
import type {
  CharacterMenu,
  CharacterMenuAction,
  SettingsBridge,
} from "../../io/bridge/settings-bridge";
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
import {
  createCharacterMenu,
  MENU_PILLS,
  type MenuActions,
} from "../../ui/character-menu/character-menu";
import { planMenuWindow } from "../../ui/character-menu/layout";
import { reloadFromStorage as reloadLocale } from "../../ui/i18n";
import { applyTextScale } from "../../ui/theme/apply-text-scale";
import { applyTheme } from "../../ui/theme/apply-theme";
import type { Disposers } from "../disposers";

const log = createLogger("wire-character-menu-window");

type Open = Extract<CharacterMenu, { type: "open" }>;

/** The menu window's own native calls. */
export interface CharacterMenuWindow {
  /** Sets its frame in global logical px. */
  setFrame(rect: ScreenRect): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  hide(): Promise<void>;
  /** Calls `cb` each time it loses focus; resolves to the unlisten. */
  onBlur(cb: () => void): Promise<() => void>;
  /** Passes the pointer through outside `isOverInteractive` while started. */
  clickThrough(opts: {
    isOverInteractive(x: number, y: number, margin: number): boolean;
    getConfig(): HitTestKnobs;
  }): { start(): void; stop(): void };
}

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
  box.style.position = "absolute";
  deps.app.appendChild(box);

  /** The newest open asked for; a queued open that is no longer it is skipped. */
  let latest: Open | null = null;
  /** The open the menu reads: the one opening, shown, or last shown. */
  let opening: Open | null = null;
  /** The open whose menu is placed in the window, until it is hidden again. */
  let placed: Open | null = null;
  /** The open the menu's picks go to: the one last placed. */
  let picksTo: Open | null = null;
  /** False once a blur, a handoff or a close request ends the placed menu; read before the hide. */
  let byUser = true;
  let leave: () => void = () => {};
  let chain: Promise<void> = Promise.resolve();

  const send = (action: CharacterMenuAction["action"], value?: unknown): void => {
    if (!picksTo) return;
    bridge.emitCharacterMenu({
      type: "action",
      id: picksTo.id,
      action,
      ...(value === undefined ? {} : { value }),
    } as CharacterMenu);
  };
  const actions: MenuActions = {
    talk: (open) => send("talk", open),
    rest: (on) => send("rest", on),
    listen: (on) => send("listen", on),
    settings: (page) => send("settings", page),
    body: (id) => send("body", id),
    voice: (id) => send("voice", id),
    pace: (pace) => send("pace", pace),
    threads: (tab) => send("threads", tab),
    bubble: (on) => send("bubble", on),
    unified: (on) => send("unified", on),
    reset: () => send("reset"),
    turnOff: () => send("turnOff"),
  };

  const clickThrough = win.clickThrough({
    isOverInteractive: (x, y, margin) =>
      [...box.querySelectorAll(MENU_PILLS)].some((el) => {
        const r = el.getBoundingClientRect();
        return (
          x >= r.left - margin &&
          x <= r.right + margin &&
          y >= r.top - margin &&
          y <= r.bottom + margin
        );
      }),
    getConfig: () => picksTo!.hitTest,
  });

  const closed = (id: string, refocus: boolean): void =>
    bridge.emitCharacterMenu({ type: "closed", id, refocus });

  const menu = createCharacterMenu({
    mount: box,
    kind: () => opening!.kind,
    name: () => opening!.name,
    read: () => opening!.state,
    async place(widths) {
      const open = opening!;
      const plan = planMenuWindow({
        frame: open.frame,
        workArea: open.workArea,
        head: open.head,
        widths,
      });
      try {
        await win.setFrame(plan.rect);
        box.style.left = `${plan.box.left}px`;
        box.style.top = `${plan.box.top}px`;
        box.style.width = `${plan.box.width}px`;
        box.style.height = `${plan.box.height}px`;
        await win.show();
        await win.setFocus();
      } catch (err) {
        await win.hide().catch(() => {});
        closed(open.id, false);
        throw err;
      }
      placed = open;
      picksTo = open;
      clickThrough.start();
      bridge.emitCharacterMenu({ type: "shown", id: open.id });
      return { fold: plan.fold, top: plan.top, chest: open.chest, head: open.nameTop };
    },
    async restore() {
      const ending = placed;
      const refocus = byUser;
      placed = null;
      clickThrough.stop();
      try {
        await win.hide();
      } finally {
        if (ending) closed(ending.id, refocus);
      }
    },
    actions,
    onBlur: (cb) => {
      leave = cb;
      return () => {};
    },
  });

  /** Closes what the window shows, then opens `open` unless a newer open came meanwhile. */
  async function present(open: Open): Promise<void> {
    if (placed) byUser = false;
    await menu.close();
    if (latest !== open) {
      closed(open.id, false);
      return;
    }
    opening = open;
    byUser = true;
    await menu.open().catch((err) => log.warn("open_failed", { error: String(err) }));
  }

  function onMessage(message: CharacterMenu): void {
    if (message.type === "open") {
      latest = message;
      chain = chain.then(() => present(message));
    } else if (message.type === "close") {
      if (placed?.id === message.id || opening?.id === message.id) {
        byUser = false;
        void menu.close();
      } else if (latest?.id === message.id) latest = null;
    } else if (message.type === "state" && opening?.id === message.id) {
      opening = { ...opening, state: message.state };
      menu.refresh();
    }
  }

  register(() => themeSettings.dispose());
  register(() => textSizeSettings.dispose());
  register(() => bridge.dispose());
  register(() => menu.dispose());
  // An unload may not outlive the hide, so the open menu reports closed first.
  register(() => {
    if (placed) closed(placed.id, false);
    placed = null;
  });
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
  register(
    await win.onBlur(() => {
      if (!placed) return;
      byUser = false;
      leave();
    }),
  );
  register(bridge.onCharacterMenu(onMessage));
  await bridge.listening();
}
