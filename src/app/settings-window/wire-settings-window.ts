import { TTS_API_KEY_SECRET } from "../../config/load";
import { createConfigStore } from "../../config/store";
import { importVrmFromFile, removeUserVrm } from "../../io/assets/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "../../io/assets/vrm-selection";
import { createDelegationHistory } from "../../io/bridge/delegations/delegation-history";
import { createMirroredDelegations } from "../../io/bridge/delegations/delegations-bridge";
import { createMirroredPushSocket } from "../../io/bridge/push/push-socket-bridge";
import { createSettingsSecretProvider } from "../../io/chat/secret-provider";
import { wireVoiceListAutoRefresh } from "../../io/voice/voices/voice-list-refresh";
import { resolveScreenSourceProvider } from "../../io/window/capture/tauri-screen";
import { closeSettingsWindow, titleSettingsWindow } from "../../io/window/openers/settings-window";
import { createLogger } from "../../logger";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { subscribe as subscribeLocale, t } from "../../ui/i18n";
import { createQuickControls } from "../../ui/quick-controls/quick-controls";
import { wireSettingsWindowSync } from "../cross-window/wire-cross-window";
import { createDisposers } from "../disposers";
import { quickControlsConfigDefaults } from "../settings/config-defaults";
import { devKeyFallback } from "../settings/dev-key-fallback";
import { createWindowStores } from "../settings/window-stores";
import { createEffectiveEndpoints, wireSpeakerSelection } from "../settings/wire-avatar";
import { wireCueLocaleSync } from "../settings/wire-cue-locale-sync";
import { wireVoiceMirror } from "./wire-voice-mirror";

const log = createLogger("settings-bootstrap");

/** Wires the settings window into `app`: stores, cross-window sync, and the re-mounting quick controls. */
export async function wireSettingsWindow(deps: { app: HTMLElement }): Promise<void> {
  const { app } = deps;
  const { register, dispose } = createDisposers();

  const { settingsStores, conversationStores } = createWindowStores(register);
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
    fallSettings,
    bubblePersistSettings,
    messageWindowSettings,
    idleMotionSettings,
    expressMotionSettings,
  } = settingsStores;
  // Quick Controls' session reset and History tab read the same instances the sync reloads.
  const { sessionStore, sessionDiagnostics, chatHistoryStore } = conversationStores;
  const voiceInputStatus = createVoiceInputStatus();
  const sourceProvider = resolveScreenSourceProvider();

  // Config for default instructions placeholder loaded best-effort only (failure → generic placeholder).
  // The TTS key rides along so this window's voice uploads reach a gated server too.
  const config = createConfigStore({
    secrets: createSettingsSecretProvider({
      stores: { [TTS_API_KEY_SECRET]: ttsKeySettings },
      fallback: devKeyFallback(),
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
    const option = await importVrmFromFile(vrmSelection);
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
    canManageVoices,
    canReuploadVoices,
    canPasteVoiceId,
  } = wireSpeakerSelection({
    getEndpoints,
    getApiKey: getTtsApiKey,
    log,
    broadcastSettings: () => broadcastSpeaker?.(),
  });
  void refreshVoiceList();
  const unsubscribeVoiceRefresh = wireVoiceListAutoRefresh({
    subscribe: endpointsSettings.subscribe,
    subscribeKey: ttsKeySettings.subscribe,
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
    conversation: conversationStores,
    vrmSelection,
    speakerSelection,
    log,
  });
  broadcastSpeaker = broadcastSettings;
  // The push socket lives in the pet window; this window mirrors it and asks it to reset.
  const pushSocket = createMirroredPushSocket({ bridge });
  // The delegations list rides the same bridge; this window mirrors it, never a second socket.
  const delegations = createMirroredDelegations({ bridge });
  // The pet window writes the history to storage before it emits the live list, so each emit is the cue to re-read it.
  const delegationHistory = createDelegationHistory();
  const unsubscribeDelegationHistory = delegations.subscribe(() =>
    delegationHistory.reloadFromStorage(),
  );
  const onWindowFocus = (): void => {
    reloadOnFocus();
    pushSocket.refresh();
    delegations.refresh();
    delegationHistory.reloadFromStorage();
  };
  window.addEventListener("focus", onWindowFocus);

  const buildQuickControls = (): ReturnType<typeof createQuickControls> => {
    titleSettingsWindow(t("settings.title"));
    return createQuickControls({
      mount: app,
      variant: "window",
      pushSocket,
      delegations: {
        get: delegationHistory.get,
        subscribe: delegationHistory.subscribe,
        refresh: delegationHistory.reloadFromStorage,
      },
      // Close settings window with Escape — closing for window variant is OS window's job.
      onCloseWindow: closeSettingsWindow,
      agentSettings,
      settings: screenshotSettings,
      idleThrottleSettings,
      gazeSettings,
      climbSettings,
      fallSettings,
      proactiveSettings,
      scheduleSettings,
      workflowSettings,
      agentNotifySettings,
      presenceSettings,
      pacerGapSettings,
      rateLimitSettings: guardrailsSettings,
      screenSettings,
      screenKnobSettings,
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
      canManageVoices,
      canReuploadVoices,
      canPasteVoiceId,
      // Renderer in main window, pass gain preview via bridge → main window VRM mouth moves.
      onGainPreview: (mouthOpen) => bridge.emitMouthPreview(mouthOpen),
      onGainPreviewEnd: () => bridge.emitMouthPreview(null),
      // The pet window owns the input source: the request travels there and is submitted.
      onGuide: (guide, text) => bridge.emitHelpGuide({ guide, text }),
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      endpointsSettings,
      chatKeySettings,
      sttKeySettings,
      ttsKeySettings,
      ...quickControlsConfigDefaults(config),
      idleMotionSettings,
      expressMotionSettings,
      sessionDiagnostics,
      sessionStore,
      transcript: chatHistoryStore,
      bubblePersistSettings,
      messageWindowSettings,
    });
  };

  // quick-controls fully re-mounts on display language change (setLocale → i18n.subscribe).
  // Defer to microtask so component doesn't destroy itself during its own click handler.
  let quickControls = buildQuickControls();
  // window variant auto-opens on creation but is idempotent, so defensively call once more.
  quickControls.open();

  const unsubscribeCueSync = wireCueLocaleSync(settingsStores);
  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      const tab = quickControls.selectedTab();
      quickControls.dispose();
      quickControls = buildQuickControls();
      quickControls.open(undefined, { tab });
    });
  });

  const disposeVoiceMirror = wireVoiceMirror({ voiceInputStatus, bridge });

  // VRM selection also signaled cross-window → pet window receives and hot-swaps renderer (backup for Tauri storage event instability).
  vrmSelection.subscribe(broadcastSettings);

  // Drains LIFO, so registered in reverse of the teardown order.
  register(() => voiceInputStatus.dispose());
  register(() => speakerSelection.dispose());
  register(() => vrmSelection.dispose());
  register(() => window.removeEventListener("focus", onWindowFocus));
  register(() => disposeSync());
  register(disposeVoiceMirror);
  register(() => delegationHistory.dispose());
  register(unsubscribeDelegationHistory);
  register(() => delegations.dispose());
  register(() => pushSocket.dispose());
  register(unsubscribeVoiceRefresh);
  register(unsubscribeLocale);
  register(unsubscribeCueSync);
  // Runs first: disposing the controls commits dirty endpoint/key fields, which must still
  // reach the broadcast path and a live bridge.
  register(() => quickControls.dispose());
  window.addEventListener("beforeunload", dispose);
}
