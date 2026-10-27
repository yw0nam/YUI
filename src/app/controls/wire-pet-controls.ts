/** The pet window's control surface: the stage context menu that opens the quick-card window. */

import type { RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { createQuickCardWindowController } from "../../io/window/openers/quick-card-window";
import type { Renderer } from "../../renderer";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import type { SettingsStores } from "../../settings/settings-stores";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import { wireCueLocaleSync } from "../settings/wire-cue-locale-sync";
import { quickCardRequest } from "./quick-card-request";

/** Wires the context menu, and hands back the quick-card window controller it opens through. */
export function wirePetControls(deps: {
  stage: HTMLElement;
  stores: SettingsStores;
  renderer: Pick<Renderer, "getCharacterAnchor" | "getCharacterWidthPx">;
  boundId: string | null;
  voiceInputStatus: VoiceInputStatus;
  remoteSurfaces: Pick<RemoteSurfaces, "onOpenSettings"> | null;
  openSettings: (page?: SettingsPage) => void;
  bridge: Pick<SettingsBridge, "emitQuickCardOpen" | "onQuickCardReady">;
  register: (teardown: () => void) => void;
}) {
  const { stage, renderer, openSettings, register } = deps;
  const controller = createQuickCardWindowController({
    boundId: deps.boundId,
    bridge: deps.bridge,
  });
  register(() => controller.dispose());
  // A popped-out surface has no settings panel of its own; it asks this window to open the settings window on Connection.
  deps.remoteSurfaces?.onOpenSettings(() => openSettings("conn"));
  register(wireCueLocaleSync(deps.stores));

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    controller.open(
      quickCardRequest({
        renderer,
        point: { x: e.clientX, y: e.clientY },
        listening: deps.boundId === null ? deps.voiceInputStatus.get().state !== "idle" : undefined,
      }),
    );
  }
  stage.addEventListener("contextmenu", onContextMenu);
  register(() => stage.removeEventListener("contextmenu", onContextMenu));

  return controller;
}
