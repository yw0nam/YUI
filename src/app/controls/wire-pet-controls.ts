/**
 * The pet window's local control surfaces: the quick-controls panel, the capture and voice-input
 * indicators, and the stage context menu — rebuilt together when the display language changes.
 */

import type { ConfigStore } from "../../config/store";
import { removeUserVrm } from "../../io/assets/vrm-import";
import type { RemoteSurfaces } from "../../io/bridge/message-remote";
import { agentTriggerableMotionIds } from "../../io/chat/broker-client";
import type { PushSocket } from "../../io/chat/push-socket";
import type { ScreenSourceProvider } from "../../io/window/capture/screen-source-provider";
import type { Renderer } from "../../renderer";
import { endpointDefaultsFromConfig } from "../../settings/backend/endpoints-settings";
import { rateLimitDefaultsFromConfig } from "../../settings/backend/guardrails-settings";
import { screenDefaultsFromConfig } from "../../settings/capture/screen-settings";
import type { SettingsStores } from "../../settings/settings-stores";
import { createCaptureIndicator } from "../../ui/chips/capture-indicator";
import { createVoiceInputIndicator } from "../../ui/chips/voice-input-indicator";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import { subscribe as subscribeLocale } from "../../ui/i18n";
import { createQuickControls } from "../../ui/quick-controls/quick-controls";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import type { wireSpeakerSelection, wireVrmSelection } from "../settings/wire-avatar";
import { wireCueLocaleSync } from "../settings/wire-cue-locale-sync";

export type QuickControls = ReturnType<typeof createQuickControls>;

/**
 * Wires the panel, both indicators, and the context menu, and hands back the live panel: `get()`
 * follows the instance across a locale remount, so consumers read it at use time.
 */
export function wirePetControls(deps: {
  root: HTMLElement;
  stage: HTMLElement;
  stores: SettingsStores;
  config: Pick<ConfigStore, "get">;
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
  >;
  pushSocket: Pick<PushSocket, "getState" | "onState" | "sendReset" | "reconnectNow">;
  stopTurn: () => void;
  voiceInputStatus: VoiceInputStatus;
  screenSourceProvider: ScreenSourceProvider;
  surfaces: Pick<Surfaces, "summonInput">;
  remoteSurfaces: Pick<RemoteSurfaces, "onOpenSettings">;
  openSettings: () => void;
  openDevtools: () => void;
  register: (teardown: () => void) => void;
}): { get(): QuickControls } {
  const {
    root,
    stage,
    stores,
    config,
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
    railCollapsedSettings,
    sectionsSettings,
    guardrailsSettings,
    bubblePersistSettings,
    messageWindowSettings,
    chatHistoryStore,
    sessionStore,
    sessionDiagnostics,
    idleMotionSettings,
    expressMotionSettings,
  } = stores;

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
      getRateLimitDefaults: () => {
        try {
          return rateLimitDefaultsFromConfig(config.get().guardrails);
        } catch {
          return undefined;
        }
      },
      screenSettings,
      screenKnobSettings,
      getScreenDefaults: () => {
        try {
          return screenDefaultsFromConfig(config.get().screen);
        } catch {
          return undefined;
        }
      },
      railCollapsedSettings,
      sectionsSettings,
      transcript: chatHistoryStore,
      // Same instances the dispatcher reads through, so "start fresh" takes effect on the next turn.
      sessionStore,
      sessionDiagnostics,
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
      onGainPreview: (mouthOpen) => renderer.setMouthOpen(mouthOpen),
      onGainPreviewEnd: () => renderer.stopMouth(),
      onOpenDevtools: openDevtools,
      // Reset the camera viewpoint to head-on (store drives renderer.setOrbit).
      onResetViewpoint: () => cameraSettings.resetOrbit(),
      // Default instructions to show as placeholder when empty (ignored if config not loaded).
      getDefaultInstructions: () => {
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
        try {
          return endpointDefaultsFromConfig(config.get().endpoints);
        } catch {
          return undefined;
        }
      },
      getDefaultChatApi: () => {
        try {
          return config.get().endpoints.chat_api;
        } catch {
          return undefined;
        }
      },
      idleMotionSettings,
      getIdlePool: () => {
        try {
          return config.get().motions.idle;
        } catch {
          return undefined;
        }
      },
      expressMotionSettings,
      getExpressMotions: () => {
        try {
          return agentTriggerableMotionIds(config.get().motions);
        } catch {
          return [];
        }
      },
      onPopOut: () => openSettings(),
      onMessage: () => surfaces.summonInput(),
    });
  // DOM surfaces re-mounted on locale change (see i18n subscriber below). Held in
  // let bindings; onActivate arrows read the live binding, so recreating is safe.
  let quickControls = buildQuickControls();
  register(() => quickControls.dispose());
  // A popped-out surface has no settings panel of its own; it asks this window for one.
  remote.onOpenSettings(() => quickControls.open(undefined, { tab: "adv" }));
  const buildCaptureIndicator = (): ReturnType<typeof createCaptureIndicator> =>
    createCaptureIndicator({
      mount: root,
      settings: screenshotSettings,
      onActivate: () => quickControls.open(),
    });
  const buildVoiceInputIndicator = (): ReturnType<typeof createVoiceInputIndicator> =>
    createVoiceInputIndicator({
      mount: root,
      status: voiceInputStatus,
      onActivate: () => quickControls.open(),
      onOpenSettings: () => quickControls.open(undefined, { tab: "adv" }),
    });
  let captureIndicator = buildCaptureIndicator();
  register(() => captureIndicator.dispose());
  let voiceInputIndicator = buildVoiceInputIndicator();
  register(() => voiceInputIndicator.dispose());

  // Re-mount localized DOM surfaces when display language changes.
  // Defer to microtask so triggering click handler (picker inside quick-controls) unwinds
  // before its host is disposed. Long-lived non-UI singletons (renderer, TTS pipeline, VAD,
  // voiceStatus store) and dispatcher-wired `surfaces` instance intentionally NOT re-created.
  register(wireCueLocaleSync(stores));
  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      voiceInputIndicator.dispose();
      captureIndicator.dispose();
      quickControls.dispose();
      quickControls = buildQuickControls();
      captureIndicator = buildCaptureIndicator();
      voiceInputIndicator = buildVoiceInputIndicator();
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
