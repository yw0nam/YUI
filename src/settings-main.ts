/**
 * Settings window (pop-out) bootstrap — settings.html entry point.
 *
 * Mounts the pet window's quick-controls standalone with variant:"window". No renderer/VRM (settings only).
 * Sync with the main window: receive localStorage writes via the `storage` event and reload the store,
 * plus reload once on focus (Tauri may not emit cross-window storage events).
 */

import "./styles.css";
import { wireSettingsWindowSync } from "./bootstrap-wiring";
import { createConfigStore } from "./config";
import { agentTriggerableMotionIds } from "./io/broker-client";
import { selectFetch } from "./io/chat-client";
import { endpointDefaultsFromConfig } from "./io/endpoints-settings";
import { rateLimitDefaultsFromConfig } from "./io/guardrails-settings";
import { updateVoice } from "./io/irodori-voices";
import { createSettingsStores } from "./io/settings-stores";
import { closeSettingsWindow } from "./io/settings-window";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import { resolveScreenSourceProvider } from "./io/tauri-screen";
import { removeUserVoice as removeUserVoiceFile } from "./io/voice-import";
import { createVoiceImportFlow } from "./io/voice-import-flow";
import { createVoiceListRefresh } from "./io/voice-list-refresh";
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
    guardrailsSettings,
    railCollapsedSettings,
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
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    bubblePersistSettings,
    idleMotionSettings,
    expressMotionSettings,
  } = settingsStores;
  const voiceInputStatus = createVoiceInputStatus();
  const sourceProvider = resolveScreenSourceProvider();

  // Config for default instructions placeholder loaded best-effort only (failure → generic placeholder).
  const config = createConfigStore();
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

  // irodori speaker selection store. This window has no synth, so store-only commit — registration
  // performed by pet window's synth path on next utterance (same as swapVrm being select-only).
  const speakerSelection = createSpeakerSelection({
    defaultValue: "",
    storage: localStorageSpeakerStorage(),
    userStorage: localStorageUserSpeakerStorage(),
  });
  // This window has no synth, so the manifest refresh is all it needs (no ensureRegistered call,
  // unlike the pet window).
  const refreshVoiceList = createVoiceListRefresh({
    getEndpoints: () => (configLoaded ? config.get().endpoints : null),
    speakerSelection,
    log,
  });
  void refreshVoiceList();
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    speakerSelection.select(option.id);
  };
  // Reference voice re-registration — unlike pet window, no synth, but update is direct server call,
  // so perform here too. Throw if config not loaded/irodori_base_url missing → UI exposes error.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const irodoriBaseUrl = configLoaded ? config.get().endpoints.irodori_base_url : undefined;
    if (!irodoriBaseUrl) throw new Error("irodori provider requires irodori_base_url");
    const f = await selectFetch();
    await updateVoice({ baseUrl: irodoriBaseUrl, id: option.id, refUrl: option.ref_url, fetch: f });
  };
  const { pickVoiceImport, commitVoiceImport } = createVoiceImportFlow({
    getIrodoriBaseUrl: () => (configLoaded ? config.get().endpoints.irodori_base_url : undefined),
    speakerSelection,
    log,
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
      proactiveSettings,
      scheduleSettings,
      workflowSettings,
      agentNotifySettings,
      presenceSettings,
      rateLimitSettings: guardrailsSettings,
      getRateLimitDefaults: () => {
        if (!configLoaded) return undefined;
        try {
          return rateLimitDefaultsFromConfig(config.get().guardrails);
        } catch {
          return undefined;
        }
      },
      railCollapsedSettings,
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
      removeUserVoice: removeUserVoiceFile,
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
      getDefaultProvider: () => {
        if (!configLoaded) return undefined;
        try {
          return config.get().endpoints.tts_provider;
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
  // Speaker selection also signaled cross-window → pet window receives and synthesizes with new speaker on next utterance.
  speakerSelection.subscribe(broadcastSettings);

  window.addEventListener("beforeunload", () => {
    // Runs first: disposing the controls commits dirty endpoint/key fields, which must still
    // reach the broadcast path and a live bridge.
    quickControls.dispose();
    unsubscribeLocale();
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
