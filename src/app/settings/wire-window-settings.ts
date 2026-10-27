/** The settings side a window without a renderer runs: stores, config, voices and the pet window's mirrors. */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { CHAT_API_KEY_SECRET, TTS_API_KEY_SECRET } from "../../config/secrets";
import { createConfigStore } from "../../config/store";
import { createMirroredPushSocket } from "../../io/bridge/push/push-socket-bridge";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { createSettingsSecretProvider } from "../../io/chat/secret-provider";
import { wireVoiceListAutoRefresh } from "../../io/voice/voices/voice-list-refresh";
import type { Logger } from "../../logger";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { isTauri } from "../../tauri-env";
import { applyTheme } from "../../ui/theme/apply-theme";
import { wireSettingsWindowSync } from "../cross-window/wire-cross-window";
import { createSessionResetAnnouncer } from "../turn/session-reset-announcer";
import { devKeyFallback } from "./dev-key-fallback";
import { createWindowStores } from "./window-stores";
import { createWindowVrmSelection } from "./window-vrm-selection";
import { createEffectiveEndpoints, wireSpeakerSelection } from "./wire-avatar";

/** Wires the shared part and registers its teardown; null when the window was disposed during the config load. */
export async function wireWindowSettings(deps: {
  bridge: SettingsBridge;
  register: (teardown: () => void) => void;
  isDisposed: () => boolean;
  presetRegistry: PresetRegistry;
  log: Logger;
}) {
  const { bridge, register, log } = deps;
  const stores = createWindowStores(register, { presetRegistry: deps.presetRegistry });
  const { settingsStores, conversationStores } = stores;
  register(
    applyTheme({
      store: settingsStores.themeSettings,
      root: document.documentElement,
      setNativeTheme: isTauri() ? (t) => getCurrentWindow().setTheme(t) : undefined,
    }),
  );

  // Config loaded best-effort only (failure → bundled defaults stay empty).
  // The TTS key rides along so this window's voice requests reach a gated server too.
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
  if (deps.isDisposed()) return null;

  // This window has no renderer, so the VRM selection commits to the store only;
  // the pet window hot-swaps the model on the change.
  const { vrmSelection, swapVrm } = createWindowVrmSelection({
    config: configLoaded ? config : null,
    log,
  });

  // Every network consumer reads endpoints through here: a server the user set only as an
  // override is invisible in the bundled config, and this window would issue no requests at all.
  const getEndpoints = createEffectiveEndpoints({
    getBundled: () => (configLoaded ? config.get().endpoints : null),
    getOverrides: () => settingsStores.endpointsSettings.get(),
  });

  // Same speaker wiring the pet window runs — voices live on the server, so no window
  // needs a synth to list, upload or pick one. The broadcast is late-bound: wireSettingsWindowSync
  // below needs the store this call creates, so it cannot hand back broadcastSettings until after.
  let broadcastSpeaker: (() => void) | null = null;
  const speaker = wireSpeakerSelection({
    getEndpoints,
    getApiKey: () => config.secrets.get(TTS_API_KEY_SECRET),
    log,
    broadcastSettings: () => broadcastSpeaker?.(),
  });
  void speaker.refreshVoiceList();
  const unsubscribeVoiceRefresh = wireVoiceListAutoRefresh({
    subscribe: settingsStores.endpointsSettings.subscribe,
    subscribeKey: settingsStores.ttsKeySettings.subscribe,
    getEndpoints,
    refresh: speaker.refreshVoiceList,
  });

  // Real-time wiring with the pet window. This window has no renderer or STT; the storage
  // fallback rides the core.
  const {
    broadcastSettings,
    reload: reloadOnFocus,
    dispose: disposeSync,
  } = wireSettingsWindowSync({
    bridge,
    stores: settingsStores,
    conversation: conversationStores,
    vrmSelection,
    speakerSelection: speaker.speakerSelection,
    log,
  });
  broadcastSpeaker = broadcastSettings;
  // VRM selection also signals cross-window → the pet window hot-swaps (backup for Tauri storage event instability).
  vrmSelection.subscribe(broadcastSettings);

  // The push socket lives in the pet window; this window mirrors it and asks it to reset.
  const pushSocket = createMirroredPushSocket({ bridge });
  // This window runs no turn: the preset's pet window stops its reply and greets when it hears the reset.
  const sessionReset = createSessionResetAnnouncer(bridge.emitSessionReset, presetIdForWindow());

  const onWindowFocus = (): void => {
    reloadOnFocus();
    pushSocket.refresh();
  };
  window.addEventListener("focus", onWindowFocus);

  // Drains LIFO, so registered in reverse of the teardown order.
  register(() => speaker.speakerSelection.dispose());
  register(() => vrmSelection.dispose());
  register(() => window.removeEventListener("focus", onWindowFocus));
  register(() => disposeSync());
  register(() => pushSocket.dispose());
  register(unsubscribeVoiceRefresh);

  return {
    ...stores,
    config,
    vrmSelection,
    swapVrm,
    speaker,
    broadcastSettings,
    pushSocket,
    sessionReset,
  };
}
