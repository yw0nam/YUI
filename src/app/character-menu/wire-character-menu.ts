/** Wires the Character menu into the pet window: a right-click on her opens it around her. */

import type { Renderer } from "../../renderer";
import type { MenuActions } from "../../ui/character-menu/character-menu";
import type { MenuKind, MenuState } from "../../ui/character-menu/items";
import type { wireLocomotion } from "../stage/wire-locomotion";

export function wireCharacterMenu(_deps: {
  stage: HTMLElement;
  /** The pet window's UI layer, pinned to her own box while the menu is open. */
  overlay: HTMLElement;
  kind: MenuKind;
  name: () => string;
  renderer: Pick<Renderer, "getTapPoints" | "getSilhouetteBounds">;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "hold" | "widen" | "abortTravel" | "frame">;
  ports: { read(): MenuState; actions: MenuActions };
}): () => void {
  return () => {};
}
