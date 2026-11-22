/** Wires the Character menu into the pet window: a right-click on her opens it around her. */

import { focusCurrentWindow, listenCurrentWindowBlur } from "../../io/window/current-window";
import type { Renderer } from "../../renderer";
import { createCharacterMenu, type MenuActions } from "../../ui/character-menu/character-menu";
import type { MenuKind, MenuState } from "../../ui/character-menu/items";
import type { wireLocomotion } from "../stage/wire-locomotion";
import { createMenuFrame } from "./character-menu-frame";

/** Returns the teardown. */
export function wireCharacterMenu(deps: {
  stage: HTMLElement;
  /** The pet root, which carries her own box while the menu widens the window. */
  root: HTMLElement;
  /** The pet window's UI layer the menu draws in. */
  overlay: HTMLElement;
  kind: MenuKind;
  name: () => string;
  renderer: Pick<Renderer, "getTapPoints" | "getSilhouetteBounds">;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "hold" | "widen" | "abortTravel" | "frame">;
  ports: { read(): MenuState; actions: MenuActions };
}): () => void {
  const frame = createMenuFrame({
    root: deps.root,
    renderer: deps.renderer,
    locomotion: deps.locomotion,
    focusWindow: focusCurrentWindow,
    onAbort: () => void menu.close(),
  });
  const menu = createCharacterMenu({
    mount: deps.overlay,
    kind: deps.kind,
    name: deps.name,
    read: deps.ports.read,
    place: frame.place,
    restore: frame.restore,
    actions: deps.ports.actions,
    onBlur: (cb) => {
      let off: (() => void) | null = null;
      let gone = false;
      void listenCurrentWindowBlur(cb).then((unlisten) => {
        if (gone) unlisten();
        else off = unlisten;
      });
      return () => {
        gone = true;
        off?.();
      };
    },
  });
  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    void menu.open();
  }
  deps.stage.addEventListener("contextmenu", onContextMenu);
  return () => {
    deps.stage.removeEventListener("contextmenu", onContextMenu);
    menu.dispose();
  };
}
