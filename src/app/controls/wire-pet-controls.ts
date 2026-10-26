/** The pet window's local control surface: the quick card and the stage context menu that opens it. */

import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import type { ConfigStore } from "../../config/store";
import type { RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { PushSocket } from "../../io/chat/push/push-socket";
import { toScreenMonitor } from "../../io/window/geometry/screen-geometry";
import { createVisibleViewport } from "../../io/window/geometry/visible-viewport";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import type { PetWindows } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { SettingsStores } from "../../settings/settings-stores";
import { isTauri } from "../../tauri-env";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import { createQuickCard, type QuickCard } from "../../ui/quick-card/quick-card";
import type { ConversationStores } from "../settings/conversation-stores";
import type { wireSpeakerSelection, wireVrmSelection } from "../settings/wire-avatar";
import { wireCueLocaleSync } from "../settings/wire-cue-locale-sync";
import { createQuickCardPorts } from "./quick-card-ports";

/** Wires the card and the context menu, and hands back the card. */
export function wirePetControls(deps: {
  root: HTMLElement;
  stage: HTMLElement;
  stores: SettingsStores;
  conversation: Pick<
    ConversationStores,
    "sessionStore" | "sessionDiagnostics" | "chatHistoryStore"
  >;
  config: Pick<ConfigStore, "get">;
  vrm: Pick<ReturnType<typeof wireVrmSelection>, "vrmSelection" | "swapVrm">;
  speaker: Pick<ReturnType<typeof wireSpeakerSelection>, "speakerSelection" | "swapSpeaker">;
  pushSocket: Pick<PushSocket, "getState" | "onState" | "sendReset">;
  stopTurn: () => void;
  announceSessionReset: () => void;
  presetRegistry: PresetRegistry;
  petWindows: PetWindows;
  boundId: string | null;
  voiceInputStatus: VoiceInputStatus;
  remoteSurfaces: Pick<RemoteSurfaces, "onOpenSettings"> | null;
  openSettings: (page?: SettingsPage) => void;
  register: (teardown: () => void) => void;
}): QuickCard {
  const { root, stage, stores, openSettings, register } = deps;

  // The pet window exists only under Tauri; a plain browser bounds the card by the webview.
  const visibleViewport = isTauri()
    ? createVisibleViewport(getCurrentWindow(), async () =>
        (await availableMonitors()).map(toScreenMonitor),
      )
    : undefined;
  const card = createQuickCard({
    mount: root,
    ...createQuickCardPorts({ ...deps, openSettings: () => openSettings() }),
    visibleViewport,
  });
  register(() => card.dispose());
  // A popped-out surface has no settings panel of its own; it asks this window to open the settings window on Connection.
  deps.remoteSurfaces?.onOpenSettings(() => openSettings("conn"));
  register(wireCueLocaleSync(stores));

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    card.open({ x: e.clientX, y: e.clientY });
  }
  stage.addEventListener("contextmenu", onContextMenu);
  register(() => stage.removeEventListener("contextmenu", onContextMenu));

  return card;
}
