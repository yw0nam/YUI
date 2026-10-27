/**
 * wire-quick-card-window — the quick-card window's wiring: the same stores and ports the settings
 * window builds, the card mounted on #app, and the dock and close that move and hide the window.
 * No renderer, no STT, no turn runs here; effects travel the settings window's cross-window paths.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSettingsBridge } from "../../io/bridge/settings-bridge";
import { createSettingsWindowOpener } from "../../io/window/openers/settings-window";
import { createLogger } from "../../logger";
import { readBoundPresetId } from "../../settings/preset/bound-preset";
import { windowLabel } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { createQuickCard } from "../../ui/quick-card/quick-card";
import type { Disposers } from "../disposers";
import { wirePetWindowsSync } from "../pet-windows/wire-pet-windows-sync";
import { wirePresetSwitch } from "../settings/wire-preset";
import { wireWindowSettings } from "../settings/wire-window-settings";
import { wireVoiceMirror } from "../settings-window/wire-voice-mirror";
import { wireQuickCardClose } from "./quick-card-close";
import { wireQuickCardDock } from "./quick-card-dock";
import { createQuickCardPorts } from "./quick-card-ports";

const log = createLogger("wire-quick-card-window");

/** Wires the quick-card window: stores, mirrored paths, the card, and its window motion. */
export async function wireQuickCardWindow(deps: {
  app: HTMLElement;
  lifecycle: Disposers;
  presetRegistry: PresetRegistry;
}): Promise<void> {
  const { register, isDisposed } = deps.lifecycle;
  const boundId = readBoundPresetId();
  const bridge = createSettingsBridge(undefined, { windowKind: "quick-card" });

  const shared = await wireWindowSettings({
    bridge,
    register,
    isDisposed,
    presetRegistry: deps.presetRegistry,
    log,
  });
  if (!shared) return;
  const { settingsStores, conversationStores, presetRegistry, petWindows, pushSocket } = shared;
  const voiceInputStatus = createVoiceInputStatus();
  const openSettings = createSettingsWindowOpener(boundId, bridge.emitSettingsPage);

  const disposePresetSwitch = wirePresetSwitch({ registry: presetRegistry, bridge, boundId });
  register(wirePetWindowsSync({ petWindows, bridge }));

  const voiceMirror = boundId === null ? wireVoiceMirror({ voiceInputStatus, bridge }) : null;

  const card = createQuickCard({
    mount: deps.app,
    ...createQuickCardPorts({
      stores: settingsStores,
      conversation: conversationStores,
      config: shared.config,
      vrm: shared,
      speaker: shared.speaker,
      pushSocket,
      announceSessionReset: shared.sessionReset.announce,
      presetRegistry,
      petWindows,
      boundId,
      voiceInputStatus,
      openSettings: () => openSettings(),
    }),
  });
  register(() => card.dispose());

  const closeControl = wireQuickCardClose({
    card,
    hide: () => getCurrentWindow().hide(),
  });
  register(() => closeControl.dispose());

  wireQuickCardDock({
    bridge,
    card: {
      open: () => card.open(),
      isOpen: () => card.isOpen(),
      el: card.el,
      cardSize: () => ({ width: card.el.offsetWidth, height: card.el.offsetHeight }),
      onHeadPointerDown: card.onHeadPointerDown,
    },
    seedListen: (listening) => voiceMirror?.applyRemote(listening ? "listening" : "idle"),
    ownerLabel: boundId === null ? "main" : windowLabel("pet", boundId),
    onShown: () => closeControl.watch(),
  });

  const disposeVoiceMirror = voiceMirror?.dispose ?? ((): void => {});

  // Drains LIFO, so registered in reverse of the teardown order.
  register(() => voiceInputStatus.dispose());
  register(disposeVoiceMirror);
  register(disposePresetSwitch);
  register(() => bridge.dispose());
  window.addEventListener("beforeunload", deps.lifecycle.dispose);
}
