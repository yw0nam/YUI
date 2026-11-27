/** The Character menu window's open sessions: each pet window's open placed and shown in turn, its picks and its close reported back to that pet window. */

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import type { ScreenRect } from "../../contract";
import type { CharacterMenu, CharacterMenuAction } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import {
  createCharacterMenu,
  MENU_PILLS,
  type MenuActions,
} from "../../ui/character-menu/character-menu";
import { planMenuWindow } from "../../ui/character-menu/layout";

const log = createLogger("menu-window-session");

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

export function createMenuWindowSession(deps: {
  /** Her box in the window: the menu draws in it, and each open sets its place. */
  mount: HTMLElement;
  win: Pick<CharacterMenuWindow, "setFrame" | "show" | "setFocus" | "hide" | "clickThrough">;
  emit(message: CharacterMenu): void;
}): {
  /** Takes a pet window's open, state or close request; other messages are ignored. */
  receive(message: CharacterMenu): void;
  /** The window lost focus. */
  blur(): void;
  /** Reports a menu still placed as closed, then ends the menu. */
  dispose(): void;
} {
  const { mount, win } = deps;

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
    deps.emit({
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
      [...mount.querySelectorAll(MENU_PILLS)].some((el) => {
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

  const closed = (id: string, refocus: boolean): void => deps.emit({ type: "closed", id, refocus });

  const menu = createCharacterMenu({
    mount,
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
        mount.style.left = `${plan.box.left}px`;
        mount.style.top = `${plan.box.top}px`;
        mount.style.width = `${plan.box.width}px`;
        mount.style.height = `${plan.box.height}px`;
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
      deps.emit({ type: "shown", id: open.id });
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

  function receive(message: CharacterMenu): void {
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

  return {
    receive,
    blur() {
      if (!placed) return;
      byUser = false;
      leave();
    },
    dispose() {
      // An unload may not outlive the hide, so the open menu reports closed first.
      if (placed) closed(placed.id, false);
      placed = null;
      menu.dispose();
    },
  };
}
