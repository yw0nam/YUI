/**
 * The pet window's local control surfaces: the quick-controls panel, rebuilt when the display
 * language changes, and the stage context menu.
 */

import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import type { ConfigStore } from "../../config/store";
import type { GuideKey } from "../../contract";
import { removeUserVrm } from "../../io/assets/vrm-import";
import type { RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { PushSocket } from "../../io/chat/push/push-socket";
import { selectFetch } from "../../io/chat/stream/chat-client";
import type { ScreenSourceProvider } from "../../io/window/capture/screen-source-provider";
import { toScreenMonitor } from "../../io/window/geometry/screen-geometry";
import { createVisibleViewport } from "../../io/window/geometry/visible-viewport";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import { isTauri } from "../../tauri-env";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import { subscribe as subscribeLocale } from "../../ui/i18n";
import { createQuickControls } from "../../ui/quick-controls/quick-controls";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { quickControlsConfigDefaults } from "../settings/config-defaults";
import type { ConversationStores } from "../settings/conversation-stores";
import type { wireSpeakerSelection, wireVrmSelection } from "../settings/wire-avatar";
import { wireCueLocaleSync } from "../settings/wire-cue-locale-sync";

export type QuickControls = ReturnType<typeof createQuickControls>;

/**
 * Wires the panel and the context menu, and hands back the live panel: `get()`
 * follows the instance across a locale remount, so consumers read it at use time.
 */
export function wirePetControls(deps: {
  root: HTMLElement;
  stage: HTMLElement;
  stores: SettingsStores;
  conversation: Pick<
    ConversationStores,
    "sessionStore" | "sessionDiagnostics" | "chatHistoryStore"
  >;
  config: Pick<ConfigStore, "get">;
  /** Resolves the chat key the chat turn would send, per request (SecretProvider path). */
  getChatApiKey: () => Promise<string | undefined>;
  renderer: Pick<Renderer, "setMouthOpen" | "stopMouth">;
  vrm: Pick<ReturnType<typeof wireVrmSelection>, "vrmSelection" | "swapVrm" | "importVrm">;
  speaker: Pick<
    ReturnType<typeof wireSpeakerSelection>,
    | "speakerSelection"
    | "swapSpeaker"
    | "refreshSpeaker"
    | "pickVoiceImport"
    | "commitVoiceImport"
    | "removeVoice"
    | "refreshVoiceList"
    | "canManageVoices"
    | "canReuploadVoices"
    | "canPasteVoiceId"
  >;
  pushSocket: Pick<PushSocket, "getState" | "onState" | "sendReset" | "reconnectNow">;
  stopTurn: () => void;
  voiceInputStatus: VoiceInputStatus;
  screenSourceProvider: ScreenSourceProvider;
  surfaces: Pick<Surfaces, "summonInput">;
  remoteSurfaces: Pick<RemoteSurfaces, "onOpenSettings">;
  openSettings: () => void;
  onGuide: (guide: GuideKey, text: string) => void;
  openDevtools: () => void;
  register: (teardown: () => void) => void;
}): { get(): QuickControls } {
  const {
    root,
    stage,
    stores,
    conversation,
    config,
    getChatApiKey,
    renderer,
    vrm,
    speaker,
    pushSocket,
    stopTurn,
    voiceInputStatus,
    screenSourceProvider,
    surfaces,
    remoteSurfaces: remote,
    openSettings,
    onGuide,
    openDevtools,
    register,
  } = deps;
  const { vrmSelection, swapVrm, importVrm } = vrm;
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
  } = speaker;
  const {
    screenshotSettings,
    ttsSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    workflowSettings,
    agentNotifySettings,
    presenceSettings,
    pacerGapSettings,
    screenSettings,
    screenKnobSettings,
    lipsyncSettings,
    vadSettings,
    agentSettings,
    fillerSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    climbSettings,
    fallSettings,
    guardrailsSettings,
    bubblePersistSettings,
    messageWindowSettings,
    idleMotionSettings,
    expressMotionSettings,
    bedSceneSettings,
  } = stores;
  // The quick-controls session reset writes the same instances the dispatcher reads through.
  const { sessionStore, sessionDiagnostics, chatHistoryStore } = conversation;

  // The pet window exists only under Tauri; a plain browser bounds the panel by the webview.
  const visibleViewport = isTauri()
    ? createVisibleViewport(getCurrentWindow(), async () =>
        (await availableMonitors()).map(toScreenMonitor),
      )
    : undefined;

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: root,
      pushSocket,
      stopTurn,
      settings: screenshotSettings,
      idleThrottleSettings,
      gazeSettings,
      climbSettings,
      fallSettings,
      proactiveSettings,
      scheduleSettings,
      workflowSettings,
      agentNotifySettings,
      bubblePersistSettings,
      messageWindowSettings,
      presenceSettings,
      pacerGapSettings,
      rateLimitSettings: guardrailsSettings,
      screenSettings,
      screenKnobSettings,
      transcript: chatHistoryStore,
      // Same instances the dispatcher reads through, so "start fresh" takes effect on the next turn.
      sessionStore,
      sessionDiagnostics,
      getChatApiKey,
      getFetch: selectFetch,
      sourceProvider: screenSourceProvider,
      voiceStatus: voiceInputStatus,
      lipsync: lipsyncSettings,
      vad: vadSettings,
      fillerSettings,
      ttsSettings,
      agentSettings,
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
      onGainPreview: (mouthOpen) => renderer.setMouthOpen(mouthOpen),
      onGainPreviewEnd: () => renderer.stopMouth(),
      onOpenDevtools: openDevtools,
      // Reset the camera viewpoint to head-on (store drives renderer.setOrbit).
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      endpointsSettings,
      chatKeySettings,
      sttKeySettings,
      ttsKeySettings,
      ...quickControlsConfigDefaults(config),
      idleMotionSettings,
      expressMotionSettings,
      bedSceneSettings,
      onPopOut: () => openSettings(),
      onMessage: () => surfaces.summonInput(),
      onGuide,
      visibleViewport,
    });
  // Re-mounted on locale change (see i18n subscriber below); consumers read the live binding.
  let quickControls = buildQuickControls();
  register(() => quickControls.dispose());
  // A popped-out surface has no settings panel of its own; it asks this window for one.
  remote.onOpenSettings(() => quickControls.open(undefined, { tab: "conn" }));

  // Re-mount localized DOM surfaces when display language changes.
  // Defer to microtask so triggering click handler (picker inside quick-controls) unwinds
  // before its host is disposed. Long-lived non-UI singletons (renderer, TTS pipeline, VAD,
  // voiceStatus store) and dispatcher-wired `surfaces` instance intentionally NOT re-created.
  register(wireCueLocaleSync(stores));
  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      quickControls.dispose();
      quickControls = buildQuickControls();
    });
  });
  register(() => unsubscribeLocale());

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    quickControls.open({ x: e.clientX, y: e.clientY });
  }
  stage.addEventListener("contextmenu", onContextMenu);
  register(() => stage.removeEventListener("contextmenu", onContextMenu));

  return { get: () => quickControls };
}
