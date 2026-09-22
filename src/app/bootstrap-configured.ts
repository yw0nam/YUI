import type { Tier1Engine } from "../ambient/liveliness/tier1";
import type { Sitter } from "../ambient/locomotion/sitter";
import type { AppConfig } from "../config/load";
import type { ConfigStore } from "../config/store";
import type { EndpointsConfig } from "../contract";
import { isChatConfigured } from "../dispatcher/backend/backend-caller";
import type { EventBus } from "../dispatcher/core/event-bus";
import type { Guardrails, GuardrailsConfig } from "../dispatcher/core/guardrails";
import type { Dispatcher } from "../dispatcher/dispatcher";
import type { UserInputSource } from "../dispatcher/sources/user-input-source";
import type { DelegationHistory } from "../io/bridge/delegation-history";
import type { DelegationsStore } from "../io/bridge/delegations-store";
import type { ReasoningStore } from "../io/bridge/reasoning-store";
import { selectFetch } from "../io/chat/chat-client";
import type { PushSocket } from "../io/chat/push-socket";
import { appendRecord } from "../io/chat/turn-record-log";
import type { ScreenCapturer } from "../io/window/capture/screen-source-provider";
import { createFrontmostTracker } from "../io/window/frontmost-tracker";
import type { SummonHotkey } from "../io/window/pet/summon-hotkey";
import { subscribeOsEvent } from "../io/window/tauri-listen";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { mergeScreen } from "../settings/capture/screen-settings";
import type { SettingsStores } from "../settings/settings-stores";
import type { VoiceInputStatus } from "../ui/chips/voice-input-status";
import { t } from "../ui/i18n";
import { maybeShowFirstRunHint } from "../ui/notices/first-run-hint";
import { wireIngressDeadNotice } from "../ui/notices/ingress-dead-notice";
import type { createQuickControls } from "../ui/quick-controls/quick-controls";
import type { Surfaces } from "../ui/surfaces/surfaces";
import {
  applyAvatarConfig,
  type wireSpeakerSelection,
  type wireVrmSelection,
} from "./settings/wire-avatar";
import { wireStageGestures } from "./stage/wire-gestures";
import { wireLocomotion } from "./stage/wire-locomotion";
import { wireGaze, wireHitTest } from "./stage/wire-stage";
import { wirePeek, wireSummonHotkey } from "./stage/wire-summon";
import { wireDispatcher } from "./turn/wire-dispatcher";
import { wirePushTransport, wireStopButton } from "./turn/wire-push";
import { wireDispatcherSources } from "./turn/wire-sources";
import { wireBroker, wireTurnVoice } from "./turn/wire-voice";
import type { VoicePipeline } from "./turn/wire-voice-pipeline";

const log = createLogger("bootstrap");

interface Phase1Handles {
  config: ConfigStore;
  renderer: Renderer;
  ambient: Tier1Engine;
  surfaces: Surfaces;
  settings: SettingsStores;
  bus: EventBus;
  userInput: UserInputSource;
  voiceInputStatus: VoiceInputStatus;
  screenCapturer: ScreenCapturer;
  vrm: ReturnType<typeof wireVrmSelection>;
  speaker: ReturnType<typeof wireSpeakerSelection>;
  root: HTMLElement;
  stage: HTMLElement;
  getQuickControls(): ReturnType<typeof createQuickControls>;
  /** The push socket, when the chat protocol is push. The host owns its lifetime. */
  pushSocket?: PushSocket;
  /** The backend's delegations list, fed by the push socket's `delegations` frames. */
  delegations: DelegationsStore;
  /** The persisted history every `delegations` frame folds into. */
  delegationHistory: DelegationHistory;
  /** The backend's reasoning text, fed by the push socket's reasoning frames and the streaming path. */
  reasoning: ReasoningStore;
  getEndpoints(): EndpointsConfig;
  /** Effective guardrails — the editable caps layered on configs/guardrails.json. */
  getGuardrails(): GuardrailsConfig;
  isDisposed(): boolean;
}

interface ConfiguredBootstrapHandles {
  voice: VoicePipeline;
  dispatcher: Dispatcher;
  guardrails: Guardrails;
  summonHotkey: SummonHotkey;
  broker: Awaited<ReturnType<typeof wireBroker>>;
  /** The seat transitions — the dev perch plays its sit-down through it. */
  sitter: Pick<Sitter, "sitDown">;
  /** Cancels the in-flight turn, cuts the outstanding push turns and stops the queued speech. */
  stopTurn: () => void;
  dispose(): void;
}

export interface ConfiguredBootstrapFactories {
  create(
    cfg: AppConfig,
    phase1: Phase1Handles,
    register: RegisterDisposer,
  ): Promise<Omit<ConfiguredBootstrapHandles, "dispose">>;
}

type RegisterDisposer = (dispose: () => void) => void;

function drain(disposers: Array<() => void>, rethrow: boolean): void {
  let firstError: unknown;
  let failed = false;
  while (disposers.length > 0) {
    try {
      disposers.pop()!();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (rethrow && failed) throw firstError;
}

const realFactories: ConfiguredBootstrapFactories = {
  async create(cfg, phase1, register) {
    const {
      config,
      renderer,
      ambient,
      surfaces,
      settings,
      bus,
      userInput,
      voiceInputStatus,
      screenCapturer,
      vrm,
      speaker,
      root,
      stage,
      getQuickControls,
      pushSocket,
      delegations,
      delegationHistory,
      reasoning,
      getEndpoints,
      getGuardrails,
    } = phase1;
    const ensureActive = (): void => {
      if (phase1.isDisposed()) throw new Error("bootstrap disposed during configured construction");
    };
    const {
      ttsSettings,
      sttSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      screenSettings,
      screenKnobSettings,
      presenceSettings,
      pacerGapSettings,
      contextHistory,
      lipsyncSettings,
      vadSettings,
      agentSettings,
      fillerSettings,
      sessionStore,
      sessionDiagnostics,
      chatHistoryStore,
      endpointsSettings,
      gazeSettings,
      climbSettings,
      fallSettings,
      hintSettings,
      guardrailsSettings,
      idleMotionSettings,
      expressMotionSettings,
    } = settings;
    const { vrmSelection, loadVrmSerialized } = vrm;
    const { speakerSelection, refreshVoiceList } = speaker;

    const turnVoice = wireTurnVoice({
      renderer,
      surfaces,
      voiceInputStatus,
      sttSettings,
      ttsSettings,
      lipsyncSettings,
      fillerSettings,
      vadSettings,
      speakerSelection,
      getEndpoints,
      getConfig: () => config.get(),
      getSecret: (name) => config.secrets.get(name),
      submitVoice: (text) => userInput.submitVoice(text),
      register,
    });
    const { voice, voiceInput, voiceErrorDwell, turnLog, previousTurn, pushTurns } = turnVoice;

    const frontmostTracker = createFrontmostTracker();
    const unlistenFrontmost = await subscribeOsEvent({ onTick: frontmostTracker.onTick, log });
    if (unlistenFrontmost) register(unlistenFrontmost);

    const turnWiring = wireDispatcher({
      bus,
      renderer,
      surfaces,
      reasoning,
      getEndpoints,
      getGuardrails,
      getConfig: () => config.get(),
      getSecret: (name) => config.secrets.get(name),
      getFetch: () => selectFetch(),
      sessionStore,
      sessionDiagnostics,
      chatHistoryStore,
      contextHistory,
      agentSettings,
      guardrailsSettings,
      pacerGapSettings,
      screenshotSettings: settings.screenshotSettings,
      screenCapturer,
      getFrontmost: () => frontmostTracker.get(),
      voice,
      turnLog,
      previousTurn,
      pushTurns,
      pushSocket: pushSocket ?? null,
      getVocabulary: () => broker.vocabulary(),
      openQuickControls: (tab) => getQuickControls().open(undefined, { tab }),
      showVoiceError: voiceErrorDwell.show,
      appendTurnRecord: (record) => appendRecord(record),
      t,
      register,
    });
    const { dispatcher, guardrails, pacer, turnFeed } = turnWiring;

    const sttVad = await voice.createSttEngine();
    voiceInput.setStt(sttVad);
    ensureActive();
    applyAvatarConfig({
      cfg,
      getConfig: () => config.get(),
      renderer,
      idleMotionSettings,
      vrmSelection,
      register,
    });
    void refreshVoiceList();
    await loadVrmSerialized(vrmSelection.getActive().url);
    ensureActive();
    maybeShowFirstRunHint({
      seen: () => hintSettings.get().enabled,
      markSeen: () => hintSettings.setEnabled(true),
      surfaces,
      hotkey: cfg.hotkeys.summon_global,
      isMac: /Mac/.test(navigator.platform || navigator.userAgent),
      chatConfigured: isChatConfigured(getEndpoints()),
      t,
    });

    const peekState = await wirePeek({ bus, register, ensureActive });
    if (peekState) turnWiring.setPeek(peekState);

    dispatcher.start();
    const {
      proactiveSource,
      scheduleSource,
      agentSource,
      signalsSource,
      milestoneSource,
      screenSource,
    } = wireDispatcherSources({
      bus,
      presenceSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      screenSettings,
      getScreenConfig: () => mergeScreen(config.get().screen, screenKnobSettings.get()),
      subscribeBusy: dispatcher.subscribeBusy,
      pipelineBusy: {
        isBusy: dispatcher.isPipelineBusy,
        subscribe: dispatcher.subscribePipelineBusy,
      },
      pacer,
    });
    turnVoice.setProactiveSource(proactiveSource);
    register(proactiveSource.stop);
    register(scheduleSource.stop);
    register(agentSource.stop);
    register(signalsSource.stop);
    register(milestoneSource.stop);
    register(screenSource.stop);
    const hitTest = wireHitTest({
      root,
      renderer,
      getQuickControls,
      getConfig: () => config.get().avatar.hit_test,
    });
    register(hitTest.stop);
    wireGaze({ renderer, gazeSettings, register });

    const locomotion = wireLocomotion({
      bus,
      renderer,
      getConfig: () => config.get(),
      dispatcher,
      hitTest,
      peekActive: () => peekState?.active() ?? false,
      fallSettings,
      climbSettings,
      agentNotifySettings,
      vrmSelection,
      onStrollEnd: (bodyReleased) => {
        if (bodyReleased) voice.resumeThinking();
      },
      register,
      log,
    });
    turnVoice.setStrolling(locomotion.walker);

    await wireStageGestures({
      stage,
      bus,
      renderer,
      ambient,
      getConfig: () => config.get(),
      drainSignals: () => signalsSource.drain(),
      hitTest,
      locomotion,
      cameraSettings: settings.cameraSettings,
      register,
    });
    ensureActive();

    const summonHotkey = wireSummonHotkey({
      surfaces,
      bus,
      peek: {
        active: () => peekState?.active() ?? false,
        exit: () => peekState?.exit() ?? Promise.resolve(),
      },
      accelerator: cfg.hotkeys.summon_global,
      onRegisterFailed: (accelerator) => {
        surfaces.beginSpeech();
        surfaces.pushSpeech(t("hotkey.register_failed", { accelerator }));
        surfaces.endSpeech();
      },
      log,
    });
    register(() => void summonHotkey.dispose());
    register(wireIngressDeadNotice({ surfaces, t }));
    const broker = await wireBroker({
      getConfig: config.get,
      getEndpoints,
      endpointsSettings,
      expressMotionSettings,
      // The socket advertises the same vocabulary the broker publishes; it diffs before it sends.
      onVocabularyChange: () => pushSocket?.sendVocabulary(),
      log,
    });
    register(broker.dispose);
    if (pushSocket) {
      register(
        wirePushTransport({
          socket: pushSocket,
          turnOutput: voice.turnOutput,
          pushTurns,
          delegations,
          delegationHistory,
          turnFeed,
          appendTurnRecord: (record) => appendRecord(record),
          appendTranscript: (entry) => chatHistoryStore.append(entry),
          log,
        }),
      );
    }
    ensureActive();
    // The stop button and the panel's session reset share this path; cancel() alone leaves queued speech playing.
    const stopTurn = (): string[] => {
      dispatcher.cancel();
      const cut = pushTurns.cut();
      voice.speechPlayback.interrupt();
      return cut;
    };
    wireStopButton({ onStop: (cb) => surfaces.onStop(cb), stopTurn, socket: pushSocket, log });
    surfaces.onSubmit((text, images) => {
      userInput.submit(text, images);
      proactiveSource.noteInteraction();
    });

    return {
      voice,
      dispatcher,
      guardrails,
      summonHotkey,
      broker,
      sitter: locomotion.sitter,
      stopTurn,
    };
  },
};

export async function createConfiguredBootstrap(
  cfg: AppConfig,
  phase1: Phase1Handles,
  factories: ConfiguredBootstrapFactories = realFactories,
): Promise<ConfiguredBootstrapHandles> {
  const disposers: Array<() => void> = [];
  const register = (dispose: () => void): void => {
    disposers.push(dispose);
  };
  try {
    const configured = await factories.create(cfg, phase1, register);
    return { ...configured, dispose: () => drain(disposers, true) };
  } catch (error) {
    drain(disposers, false);
    throw error;
  }
}
