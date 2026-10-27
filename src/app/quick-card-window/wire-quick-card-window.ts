/**
 * wire-quick-card-window — the quick-card window's wiring: the same stores and ports the settings
 * window builds, the card mounted on #app, and the dock and close that move and hide the window.
 * No renderer, no STT, no turn runs here; effects travel the settings window's cross-window paths.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { CHAT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../../config/secrets";
import { createConfigStore } from "../../config/store";
import { createMirroredPushSocket } from "../../io/bridge/push/push-socket-bridge";
import { createSettingsBridge } from "../../io/bridge/settings-bridge";
import { createSettingsSecretProvider } from "../../io/chat/secret-provider";
import { wireVoiceListAutoRefresh } from "../../io/voice/voices/voice-list-refresh";
import { createSettingsWindowOpener } from "../../io/window/openers/settings-window";
import { createLogger } from "../../logger";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import { readBoundPresetId } from "../../settings/preset/bound-preset";
import { windowLabel } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { isTauri } from "../../tauri-env";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { createQuickCard } from "../../ui/quick-card/quick-card";
import { applyTheme } from "../../ui/theme/apply-theme";
import { wireSettingsWindowSync } from "../cross-window/wire-cross-window";
import type { Disposers } from "../disposers";
import { wirePetWindowsSync } from "../pet-windows/wire-pet-windows-sync";
import { devKeyFallback } from "../settings/dev-key-fallback";
import { createWindowStores } from "../settings/window-stores";
import { createWindowVrmSelection } from "../settings/window-vrm-selection";
import { createEffectiveEndpoints, wireSpeakerSelection } from "../settings/wire-avatar";
import { wirePresetSwitch } from "../settings/wire-preset";
import { wireVoiceMirror } from "../settings-window/wire-voice-mirror";
import { createSessionResetAnnouncer } from "../turn/session-reset-announcer";
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

  const { settingsStores, conversationStores, presetRegistry, petWindows } = createWindowStores(
    register,
    { presetRegistry: deps.presetRegistry },
  );
  register(
    applyTheme({
      store: settingsStores.themeSettings,
      root: document.documentElement,
      setNativeTheme: isTauri() ? (t) => getCurrentWindow().setTheme(t) : undefined,
    }),
  );

  // The TTS key rides along so this window's voice list reaches a gated server, same as settings.
  const config = createConfigStore({
    secrets: createSettingsSecretProvider({
      stores: {
        [CHAT_API_KEY_SECRET]: settingsStores.chatKeySettings,
        [TTS_API_KEY_SECRET]: settingsStores.ttsKeySettings,
      },
      fallback: devKeyFallback(),
    }),
  });
  let configLoaded = false;
  try {
    await config.load();
    configLoaded = true;
  } catch (err) {
    log.warn("config_load_failed", { error: String(err) });
  }
  if (isDisposed()) return;

  const { vrmSelection, swapVrm } = createWindowVrmSelection({
    config: configLoaded ? config : null,
    log,
  });
  const getEndpoints = createEffectiveEndpoints({
    getBundled: () => (configLoaded ? config.get().endpoints : null),
    getOverrides: () => settingsStores.endpointsSettings.get(),
  });
  let broadcastSpeaker: (() => void) | null = null;
  const { speakerSelection, swapSpeaker, refreshVoiceList } = wireSpeakerSelection({
    getEndpoints,
    getApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    log,
    broadcastSettings: () => broadcastSpeaker?.(),
  });
  void refreshVoiceList();
  const unsubscribeVoiceRefresh = wireVoiceListAutoRefresh({
    subscribe: settingsStores.endpointsSettings.subscribe,
    subscribeKey: settingsStores.ttsKeySettings.subscribe,
    getEndpoints,
    refresh: refreshVoiceList,
  });

  const {
    broadcastSettings,
    reload: reloadOnFocus,
    dispose: disposeSync,
  } = wireSettingsWindowSync({
    bridge,
    stores: settingsStores,
    conversation: conversationStores,
    vrmSelection,
    speakerSelection,
    log,
  });
  broadcastSpeaker = broadcastSettings;

  // The push socket, delegations and reasoning live in the pet window; this window mirrors them.
  const pushSocket = createMirroredPushSocket({ bridge });
  // The preset's pet window stops its reply and greets when it hears the reset.
  const sessionReset = createSessionResetAnnouncer(bridge.emitSessionReset, presetIdForWindow());
  const voiceInputStatus = createVoiceInputStatus();
  const openSettings = createSettingsWindowOpener(boundId, bridge.emitSettingsPage);

  const onWindowFocus = (): void => {
    reloadOnFocus();
    pushSocket.refresh();
  };
  window.addEventListener("focus", onWindowFocus);

  // VRM and speaker selections signal cross-window like their settings rows do.
  vrmSelection.subscribe(broadcastSettings);
  const disposePresetSwitch = wirePresetSwitch({ registry: presetRegistry, bridge, boundId });
  register(wirePetWindowsSync({ petWindows, bridge }));

  const voiceMirror = boundId === null ? wireVoiceMirror({ voiceInputStatus, bridge }) : null;

  const card = createQuickCard({
    mount: deps.app,
    ...createQuickCardPorts({
      stores: settingsStores,
      conversation: conversationStores,
      config,
      vrm: { vrmSelection, swapVrm },
      speaker: { speakerSelection, swapSpeaker },
      pushSocket,
      announceSessionReset: sessionReset.announce,
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
  });

  const disposeVoiceMirror = voiceMirror?.dispose ?? ((): void => {});

  // Drains LIFO, so registered in reverse of the teardown order.
  register(() => voiceInputStatus.dispose());
  register(() => speakerSelection.dispose());
  register(() => vrmSelection.dispose());
  register(() => window.removeEventListener("focus", onWindowFocus));
  register(() => disposeSync());
  register(disposeVoiceMirror);
  register(disposePresetSwitch);
  register(unsubscribeVoiceRefresh);
  register(() => bridge.dispose());
  window.addEventListener("beforeunload", deps.lifecycle.dispose);
}
