import { CHAT_API_KEY_SECRET } from "../../config/secrets";
import { importVrmFromFile, removeUserVrm } from "../../io/assets/vrm-import";
import { createDelegationHistory } from "../../io/bridge/delegations/delegation-history";
import { createMirroredDelegations } from "../../io/bridge/delegations/delegations-bridge";
import { createSettingsBridge } from "../../io/bridge/settings-bridge";
import { selectFetch } from "../../io/chat/stream/chat-client";
import { resolveScreenSourceProvider } from "../../io/window/capture/tauri-screen";
import { closeSettingsWindow, titleSettingsWindow } from "../../io/window/openers/settings-window";
import { createLogger } from "../../logger";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import { readBoundPresetId } from "../../settings/preset/bound-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { createUnifiedShown } from "../../settings/unified/unified-shown";
import { createVoiceInputStatus } from "../../ui/chips/voice-input-status";
import { subscribe as subscribeLocale, t } from "../../ui/i18n";
import { createQuickControls } from "../../ui/quick-controls/quick-controls";
import { wireCardIo } from "../card-io/wire-card-io";
import type { Disposers } from "../disposers";
import { wirePetWindowsSync } from "../pet-windows/wire-pet-windows-sync";
import { quickControlsConfigDefaults } from "../settings/config-defaults";
import { wireCueLocaleSync } from "../settings/wire-cue-locale-sync";
import { wirePresetSwitch } from "../settings/wire-preset";
import { wireWindowSettings } from "../settings/wire-window-settings";
import { editTargetUrl } from "./edit-target-url";
import { takeRequestedPage, wireSettingsPage } from "./wire-settings-page";
import { wireVoiceMirror } from "./wire-voice-mirror";

const log = createLogger("settings-bootstrap");

/** Wires the settings window into `app`: stores, cross-window sync, and the re-mounting quick controls. */
export async function wireSettingsWindow(deps: {
  app: HTMLElement;
  lifecycle: Disposers;
  presetRegistry: PresetRegistry;
}): Promise<void> {
  const { app } = deps;
  const { register, dispose } = deps.lifecycle;
  const boundId = readBoundPresetId();
  const requestedPage = takeRequestedPage();
  const reloadOnCharacter = (id: string, page?: SettingsPage): void =>
    location.replace(
      editTargetUrl(location.href, id, boundId ?? deps.presetRegistry.get().active, page),
    );
  // Listens from the start: an opener may ask for a page while this window still boots.
  const bridge = createSettingsBridge(undefined, { windowKind: "settings" });
  const settingsPage = wireSettingsPage({
    bridge,
    boundId,
    editing: presetIdForWindow,
    active: () => deps.presetRegistry.get().active,
    retarget: reloadOnCharacter,
  });
  register(settingsPage.dispose);

  const shared = await wireWindowSettings({
    bridge,
    register,
    isDisposed: deps.lifecycle.isDisposed,
    presetRegistry: deps.presetRegistry,
    log,
  });
  if (!shared) return;
  const {
    settingsStores,
    conversationStores,
    presetRegistry,
    petWindows,
    config,
    vrmSelection,
    swapVrm,
    pushSocket,
    sessionReset,
  } = shared;
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
  } = shared.speaker;
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
    readingsSettings,
    ttsSettings,
    agentSettings,
    userNameSettings,
    themeSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    climbSettings,
    fallSettings,
    bubblePersistSettings,
    oneVoiceSettings,
    messageWindowSettings,
    idleMotionSettings,
    expressMotionSettings,
    bedSceneSettings,
    relationsSwitch,
    unifiedChatSwitch,
  } = settingsStores;
  // Quick Controls' session reset and History tab read the same instances the sync reloads.
  const { sessionStore, sessionDiagnostics, chatHistoryStore, signalHistoryStore } =
    conversationStores;
  const voiceInputStatus = createVoiceInputStatus();
  const sourceProvider = resolveScreenSourceProvider();

  // BYO-VRM import (settings window) — no renderer, delegate load/metadata to pet window. Copy file,
  // add option with filename stem label, select only. Pet window performs actual load cross-window.
  // Cancel (null) silently ignored.
  const importVrm = async (): Promise<void> => {
    const option = await importVrmFromFile(vrmSelection);
    if (option === null) return;
    vrmSelection.addUserOption(option);
    vrmSelection.select(option.id);
  };

  const unifiedShown = createUnifiedShown({
    switch: unifiedChatSwitch,
    onPetWindowsChanged: bridge.onPetWindowsChanged,
  });
  register(unifiedShown.dispose);
  // The delegations list rides the same bridge; this window mirrors it, never a second socket.
  const delegations = createMirroredDelegations({ bridge });
  // The pet window writes the history to storage before it emits the live list, so each emit is the cue to re-read it.
  const delegationHistory = createDelegationHistory();
  const unsubscribeDelegationHistory = delegations.subscribe(() =>
    delegationHistory.reloadFromStorage(),
  );
  const onWindowFocus = (): void => {
    delegations.refresh();
    delegationHistory.reloadFromStorage();
  };
  window.addEventListener("focus", onWindowFocus);

  const buildQuickControls = (): ReturnType<typeof createQuickControls> => {
    titleSettingsWindow(t("settings.title"));
    return createQuickControls({
      mount: app,
      pushSocket,
      announceSessionReset: sessionReset.announce,
      delegations: {
        get: delegationHistory.get,
        subscribe: delegationHistory.subscribe,
        refresh: delegationHistory.reloadFromStorage,
      },
      // Escape closes the settings window.
      onCloseWindow: closeSettingsWindow,
      agentSettings,
      userNameSettings,
      themeSettings,
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
      readingsSettings,
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
      ...wireCardIo(presetRegistry),
      // Renderer in main window, pass gain preview via bridge → main window VRM mouth moves.
      onGainPreview: (mouthOpen) => bridge.emitMouthPreview(mouthOpen),
      onGainPreviewEnd: () => bridge.emitMouthPreview(null),
      // The pet window owns the input source: the request travels there and is submitted.
      onGuide: (guide, text) => bridge.emitHelpGuide({ guide, text }),
      getChatApiKey: () => config.secrets.get(CHAT_API_KEY_SECRET),
      getFetch: selectFetch,
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      endpointsSettings,
      chatKeySettings,
      sttKeySettings,
      ttsKeySettings,
      ...quickControlsConfigDefaults(config),
      idleMotionSettings,
      expressMotionSettings,
      bedSceneSettings,
      sessionDiagnostics,
      sessionStore,
      transcript: chatHistoryStore,
      signalHistory: signalHistoryStore,
      bubblePersistSettings,
      oneVoiceSettings,
      messageWindowSettings,
      presetRegistry,
      petWindows,
      relationsStore: conversationStores.relationsStore,
      relationsSwitch,
      unifiedChatSwitch,
      unifiedShown,
      boundId,
      onEditTarget: (id) => reloadOnCharacter(id),
      showVoiceInput: boundId === null,
      onOpenDevtools: bridge.emitOpenDevtools,
    });
  };

  // quick-controls fully re-mounts on display language change (setLocale → i18n.subscribe).
  // Defer to microtask so component doesn't destroy itself during its own click handler.
  let quickControls = buildQuickControls();
  // The panel opens on creation; open() is idempotent and lands on the requested page.
  quickControls.open(requestedPage ? { tab: requestedPage } : undefined);
  settingsPage.attach((page) => quickControls.open({ tab: page }));

  const unsubscribeCueSync = wireCueLocaleSync(settingsStores);
  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      if (deps.lifecycle.isDisposed()) return;
      const tab = quickControls.selectedTab();
      quickControls.dispose();
      quickControls = buildQuickControls();
      quickControls.open({ tab });
    });
  });

  const disposeVoiceMirror =
    boundId === null ? wireVoiceMirror({ voiceInputStatus, bridge }).dispose : () => {};

  // The pet window stops the turn on the same switch; this window only follows it.
  const disposePresetSwitch = wirePresetSwitch({ registry: presetRegistry, bridge, boundId });

  // Drains LIFO, so registered in reverse of the teardown order.
  register(wirePetWindowsSync({ petWindows, bridge }));
  register(disposePresetSwitch);
  register(() => voiceInputStatus.dispose());
  register(() => window.removeEventListener("focus", onWindowFocus));
  register(disposeVoiceMirror);
  register(() => delegationHistory.dispose());
  register(unsubscribeDelegationHistory);
  register(() => delegations.dispose());
  register(unsubscribeLocale);
  register(unsubscribeCueSync);
  // Runs first: disposing the controls commits dirty endpoint/key fields, which must still
  // reach the broadcast path and a live bridge.
  register(() => quickControls.dispose());
  window.addEventListener("beforeunload", dispose);
}
