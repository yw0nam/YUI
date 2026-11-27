/** Wires the Character menu into the pet window: a right-click on her opens it in the Character menu window, which sends her picks back here. */

import type { HitTestKnobs } from "../../config/validators/avatar/types";
import type { MenuKind, MenuState, SettingsBridge } from "../../io/bridge/settings-bridge";
import { focusCurrentWindow } from "../../io/window/current-window";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import { isTauri } from "../../tauri-env";
import type { MenuActions } from "../../ui/character-menu/character-menu";
import type { wireLocomotion } from "../stage/wire-locomotion";
import { createPetMenuOpener } from "./pet-menu-opener";
import { readMenuPlacement } from "./read-menu-placement";

const log = createLogger("wire-character-menu");

/** Returns the teardown. */
export function wireCharacterMenu(deps: {
  stage: HTMLElement;
  /** The pet window's UI layer, marked while her menu shows. */
  overlay: HTMLElement;
  /** This pet window's label. */
  label: string;
  kind: MenuKind;
  name: () => string;
  renderer: Pick<Renderer, "getTapPoints" | "getSilhouetteBounds">;
  locomotion: Pick<ReturnType<typeof wireLocomotion>, "hold" | "abortTravel" | "frame">;
  hitTest: () => HitTestKnobs;
  bridge: Pick<SettingsBridge, "emitCharacterMenu" | "onCharacterMenu">;
  ports: { read(): MenuState; actions: MenuActions };
}): () => void {
  const opener = createPetMenuOpener({
    label: deps.label,
    kind: deps.kind,
    name: deps.name,
    hitTest: deps.hitTest,
    overlay: deps.overlay,
    locomotion: deps.locomotion,
    readPlacement: () => readMenuPlacement(deps),
    ports: deps.ports,
    emit: deps.bridge.emitCharacterMenu,
    focusWindow: focusCurrentWindow,
  });
  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (!isTauri()) return;
    opener.open().catch((err) => log.warn("open_failed", { error: String(err) }));
  }
  const offMenu = deps.bridge.onCharacterMenu(opener.receive);
  deps.stage.addEventListener("contextmenu", onContextMenu);
  return () => {
    deps.stage.removeEventListener("contextmenu", onContextMenu);
    offMenu();
    opener.dispose();
  };
}
