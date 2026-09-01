/**
 * Settings window (pop-out) bootstrap — settings.html entry point.
 *
 * Mounts the pet window's quick-controls standalone with variant:"window". No renderer/VRM (settings only).
 * Sync with the main window: receive localStorage writes via the `storage` event and reload the store,
 * plus reload once on focus (Tauri may not emit cross-window storage events).
 */

import "./styles.css";
import {
  createEffectiveEndpoints,
  wireSettingsWindowSync,
  wireSpeakerSelection,
} from "./bootstrap-wiring";
import { createConfigStore, TTS_API_KEY_SECRET } from "./config";
import { agentTriggerableMotionIds } from "./io/broker-client";
import { endpointDefaultsFromConfig } from "./io/endpoints-settings";
import { rateLimitDefaultsFromConfig } from "./io/guardrails-settings";
import { screenDefaultsFromConfig } from "./io/screen-settings";
import { createSettingsSecretProvider } from "./io/secret-provider";
import { createSettingsStores } from "./io/settings-stores";
import { closeSettingsWindow } from "./io/settings-window";
import { resolveScreenSourceProvider } from "./io/tauri-screen";
import { wireVoiceListAutoRefresh } from "./io/voice-list-refresh";
import { importVrmFromFile, removeUserVrm } from "./io/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./io/vrm-selection";
import { createLogger, initLogger } from "./logger";
import { getLocale, subscribe as subscribeLocale } from "./ui/i18n";
import { createQuickControls } from "./ui/quick-controls";
import { createVoiceInputStatus } from "./ui/voice-input-status";

const log = createLogger("settings-bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const settingsStores = createSettingsStores({ locale: getLocale() });
  const {
    screenshotSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    workflowSettings,
    agentNotifySettings,
    presenceSettings,
    pacerGapSettings,
    screenSettings,
    screenKnobSettings,
    guardrailsSettings,
    railCollapsedSettings,
    sectionsSettings,
    lipsyncSettings,
    vadSettings,
    fillerSettings,
    ttsSettings,
    agentSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    climbSettings,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    bubblePersistSettings,
    messageWindowSettings,
    idleMotionSettings,
    expressMotionSettings,
  } = settingsStores;
  const voiceInputStatus = createVoiceInputStatus();
  const sourceProvider = resolveScreenSourceProvider();

  // Config for default instructions placeholder loaded best-effort only (failure → generic placeholder).
  // The TTS key rides along so this window's voice uploads reach a gated server too.
  const config = createConfigStore({
    secrets: createSettingsSecretProvider({
      stores: { [TTS_API_KEY_SECRET]: ttsKeySettings },
      fallback: { [TTS_API_KEY_SECRET]: import.meta.env.VITE_YUI_TTS_KEY },
    }),
  });
  const getTtsApiKey = (): Promise<string | undefined> => config.secrets.get(TTS_API_KEY_SECRET);
  let configLoaded = false;
  try {
    await config.load();
    configLoaded = true;
  } catch (err) {
    log.warn("config_load_failed", { error: String(err) });
  }

  // VRM selection store + swap. This window has no renderer, so store-only commit.
  // Main window hot-swaps actual VRM via storage reload.
  // Create with fallback default, inject actual available[] if config loaded (same as main window).
  const vrmSelection = createVrmSelection({
    defaultValue: "/vrms/Sendagaya_Shino.vrm",
    storage: localStorageVrmStorage(),
    userStorage: localStorageUserVrmStorage(),
  });
  if (configLoaded) {
    try {
      const avatar = config.get().avatar;
      vrmSelection.setManifest({ available: avatar.available, defaultValue: avatar.vrm_url });
    } catch (err) {
      log.warn("avatar_config_read_failed", { fallback: true, error: String(err) });
    }
  }
  const swapVrm = async (option: { id: string }): Promise<void> => {
    vrmSelection.select(option.id);
  };
  // BYO-VRM import (settings window) — no renderer, delegate load/metadata to pet window. Copy file,
  // add option with filename stem label, select only. Pet window performs actual load cross-window.
  // Cancel (null) silently ignored.
  const importVrm = async (): Promise<void> => {
    const option = await importVrmFromFile();
    if (option === null) return;
    vrmSelection.addUserOption(option);
    vrmSelection.select(option.id);
  };

  // Every network consumer reads endpoints through here: a server the user set only as an
  // override is invisible in the bundled config, and this window would issue no requests at all.
  const getEndpoints = createEffectiveEndpoints({
    getBundled: () => (configLoaded ? config.get().endpoints : null),
    getOverrides: () => endpointsSettings.get(),
  });

  // Same speaker wiring the pet window runs — voices live on the server, so neither window
  // needs a synth to list, upload or pick one. The broadcast is late-bound: wireSettingsWindowSync
  // below needs the store this call creates, so it cannot hand back broadcastSettings until after.
  let broadcastSpeaker: (() => void) | null = null;
  const {
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    pickVoiceImport,
    commitVoiceImport,
    removeVoice,
    refreshVoiceList,
  } = wireSpeakerSelection({
    getEndpoints,
    getApiKey: getTtsApiKey,
    log,
    broadcastSettings: () => broadcastSpeaker?.(),
  });
  void refreshVoiceList();
  const unsubscribeVoiceRefresh = wireVoiceListAutoRefresh({
    subscribe: endpointsSettings.subscribe,
    getEndpoints,
    refresh: refreshVoiceList,
  });

  // Real-time wiring with main window (Tauri events). This window has no renderer/STT, so send controls
  // to main window, receive voice state from main window and reflect. Storage fallback rides the core.
  const {
    bridge,
    broadcastSettings,
    reload: reloadOnFocus,
    dispose: disposeSync,
  } = wireSettingsWindowSync({
    stores: settingsStores,
    vrmSelection,
    speakerSelection,
    log,
  });
  broadcastSpeaker = broadcastSettings;
  window.addEventListener("focus", reloadOnFocus);

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: app,
      variant: "window",
      // Close settings window with Escape — closing for window variant is OS window's job.
      onCloseWindow: closeSettingsWindow,
      agentSettings,
      settings: screenshotSettings,
      idleThrottleSettings,
      gazeSettings,
      climbSettings,
      proactiveSettings,
      scheduleSettings,
      workflowSettings,
      agentNotifySettings,
      presenceSettings,
      pacerGapSettings,
      rateLimitSettings: guardrailsSettings,
      getRateLimitDefaults: () => {
        if (!configLoaded) return undefined;
        try {
          return rateLimitDefaultsFromConfig(config.get().guardrails);
        } catch {
          return undefined;
        }
      },
      screenSettings,
      screenKnobSettings,
      getScreenDefaults: () => {
        if (!configLoaded) return undefined;
        try {
          return screenDefaultsFromConfig(config.get().screen);
        } catch {
          return undefined;
        }
      },
      railCollapsedSettings,
      sectionsSettings,
      sourceProvider,
      voiceStatus: voiceInputStatus,
      lipsync: lipsyncSettings,
      vad: vadSettings,
      fillerSettings,
      ttsSettings,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      pickVoiceImport,
      commitVoiceImport,
      removeVoice,
      refreshVoiceList,
      // Renderer in main window, pass gain preview via bridge → main window VRM mouth moves.
      onGainPreview: (mouthOpen) => bridge.emitMouthPreview(mouthOpen),
      onGainPreviewEnd: () => bridge.emitMouthPreview(null),
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      getDefaultInstructions: () => {
        if (!configLoaded) return undefined;
        try {
          return config.get().endpoints.chat_instructions;
        } catch {
          return undefined;
        }
      },
      endpointsSettings,
      chatKeySettings,
      sttKeySettings,
      ttsKeySettings,
      getEndpointDefaults: () => {
        if (!configLoaded) return undefined;
        try {
          return endpointDefaultsFromConfig(config.get().endpoints);
        } catch {
          return undefined;
        }
      },
      getDefaultChatApi: () => {
        if (!configLoaded) return undefined;
        try {
          return config.get().endpoints.chat_api;
        } catch {
          return undefined;
        }
      },
      idleMotionSettings,
      getIdlePool: () => {
        if (!configLoaded) return undefined;
        try {
          return config.get().motions.idle;
        } catch {
          return undefined;
        }
      },
      expressMotionSettings,
      getExpressMotions: () => {
        if (!configLoaded) return [];
        try {
          return agentTriggerableMotionIds(config.get().motions);
        } catch {
          return [];
        }
      },
      sessionDiagnostics,
      sessionStore,
      transcript: chatHistoryStore,
      bubblePersistSettings,
      messageWindowSettings,
    });

  // quick-controls fully re-mounts on display language change (setLocale → i18n.subscribe).
  // Defer to microtask so component doesn't destroy itself during its own click handler.
  let quickControls = buildQuickControls();
  // window variant auto-opens on creation but is idempotent, so defensively call once more.
  quickControls.open();

  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      quickControls.dispose();
      quickControls = buildQuickControls();
      quickControls.open();
    });
  });

  // Voice toggle (this window → main STT) and voice state reflection (main → this window).
  // Component drives local voiceInputStatus, so send changes to main, receive actual STT state and reflect.
  let applyingRemoteVoice = false;
  voiceInputStatus.subscribe((snap) => {
    if (!applyingRemoteVoice) bridge.emitVoiceSet(snap.state !== "idle");
  });
  bridge.onVoiceState((s) => {
    applyingRemoteVoice = true;
    try {
      voiceInputStatus.set(s.state);
    } finally {
      applyingRemoteVoice = false;
    }
  });

  // VRM selection also signaled cross-window → pet window receives and hot-swaps renderer (backup for Tauri storage event instability).
  vrmSelection.subscribe(broadcastSettings);

  window.addEventListener("beforeunload", () => {
    // Runs first: disposing the controls commits dirty endpoint/key fields, which must still
    // reach the broadcast path and a live bridge.
    quickControls.dispose();
    unsubscribeLocale();
    unsubscribeVoiceRefresh();
    disposeSync();
    window.removeEventListener("focus", reloadOnFocus);
    for (const store of Object.values(settingsStores)) store.dispose();
    vrmSelection.dispose();
    speakerSelection.dispose();
    voiceInputStatus.dispose();
  });
}

void bootstrap().catch((error) => {
  log.error("boot_failed", { error: String(error) });
});
