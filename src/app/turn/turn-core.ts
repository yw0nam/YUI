import type { AppConfig } from "../../config/load";
import type { ConfigStore } from "../../config/store";
import type { EndpointsConfig } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import type { Guardrails, GuardrailsConfig } from "../../dispatcher/core/guardrails";
import type { ProactivePacer } from "../../dispatcher/core/proactive-pacer";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import type { UserInputSource } from "../../dispatcher/sources/user-input-source";
import type { DelegationHistory } from "../../io/bridge/delegations/delegation-history";
import type { DelegationsStore } from "../../io/bridge/delegations/delegations-store";
import type { ReasoningStore } from "../../io/bridge/reasoning/reasoning-store";
import type { PushSocket } from "../../io/chat/push/push-socket";
import { appendRecord } from "../../io/chat/record/turn-record-log";
import { selectFetch } from "../../io/chat/stream/chat-client";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import { t } from "../../ui/i18n";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import type { ConversationStores } from "../settings/conversation-stores";
import {
  applyAvatarConfig,
  type wireSpeakerSelection,
  type wireVrmSelection,
} from "../settings/wire-avatar";
import { wireDispatcher } from "./wire-dispatcher";
import { wirePushTransport, wireStopButton } from "./wire-push";
import { type VoiceHost, type VoicePersistence, wireBroker, wireTurnVoice } from "./wire-voice";
import type { VoicePipeline } from "./wire-voice-pipeline";

const log = createLogger("bootstrap");

type DispatcherDeps = Parameters<typeof wireDispatcher>[0];
type Broker = Awaited<ReturnType<typeof wireBroker>>;

/** The handles a window that hosts the chat turn built before its config loaded. */
export interface TurnCorePhase1 {
  config: ConfigStore;
  renderer: Renderer;
  surfaces: Surfaces;
  settings: SettingsStores;
  conversation: ConversationStores;
  bus: EventBus;
  userInput: UserInputSource;
  voiceInputStatus: VoiceInputStatus;
  vrm: ReturnType<typeof wireVrmSelection>;
  speaker: ReturnType<typeof wireSpeakerSelection>;
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
}

export interface TurnCore {
  voice: VoicePipeline;
  dispatcher: Dispatcher;
  guardrails: Guardrails;
  pacer: ProactivePacer;
  setPeek(peek: { enter(): Promise<void>; exit(): Promise<void> }): void;
  setProactiveSource(source: { noteInteraction(ts?: number): void }): void;
  setStrolling(walker: { isStrolling(): boolean }): void;
  /** Starts the dispatcher on the bus. */
  start(): void;
  /** Publishes the broker, routes the push socket, and wires the stop button and the submit path. */
  connect(hooks: { onSubmit: () => void }): Promise<{ broker: Broker; stopTurn: () => string[] }>;
}

/**
 * The chat turn every window that talks to the backend runs: voice, dispatcher, STT, the avatar,
 * the broker, the push transport, stop and submit. Built through the VRM load; the host runs
 * start() and connect() at the points its own wiring leaves for them.
 */
export async function wireTurnCore(
  cfg: AppConfig,
  phase1: TurnCorePhase1,
  deps: {
    getFrontmost: DispatcherDeps["getFrontmost"];
    screenCapturer: DispatcherDeps["screenCapturer"];
    openQuickControls?: DispatcherDeps["openQuickControls"];
    /** Where voice-on intent is kept across runs; a window that passes none starts every run silent. */
    voicePersistence?: VoicePersistence;
    /** A window that owns capture intent itself. */
    voiceHost?: VoiceHost;
    register: (dispose: () => void) => void;
    ensureActive: () => void;
  },
): Promise<TurnCore> {
  const {
    config,
    renderer,
    surfaces,
    settings,
    conversation,
    bus,
    userInput,
    voiceInputStatus,
    vrm,
    speaker,
    pushSocket,
    delegations,
    delegationHistory,
    reasoning,
    getEndpoints,
    getGuardrails,
  } = phase1;
  const { register, ensureActive } = deps;
  const { contextHistory, sessionStore, sessionDiagnostics, chatHistoryStore } = conversation;
  const { vrmSelection, loadVrmSerialized } = vrm;
  const { speakerSelection, refreshVoiceList, migrateVoiceIds } = speaker;
  // Published by connect(); a turn reads it when it builds its client tools.
  let broker: Broker | undefined;

  const turnVoice = wireTurnVoice({
    renderer,
    surfaces,
    voiceInputStatus,
    voicePersistence: deps.voicePersistence,
    voiceHost: deps.voiceHost,
    ttsSettings: settings.ttsSettings,
    lipsyncSettings: settings.lipsyncSettings,
    fillerSettings: settings.fillerSettings,
    vadSettings: settings.vadSettings,
    speakerSelection,
    getEndpoints,
    getConfig: () => config.get(),
    getSecret: (name) => config.secrets.get(name),
    submitVoice: (text) => userInput.submitVoice(text),
    register,
  });
  const { voice, voiceInput, voiceErrorDwell, turnLog, previousTurn, quotedTurn, pushTurns } =
    turnVoice;

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
    agentSettings: settings.agentSettings,
    guardrailsSettings: settings.guardrailsSettings,
    pacerGapSettings: settings.pacerGapSettings,
    screenshotSettings: settings.screenshotSettings,
    screenCapturer: deps.screenCapturer,
    getFrontmost: deps.getFrontmost,
    voice,
    turnLog,
    previousTurn,
    quotedTurn,
    pushTurns,
    pushSocket: pushSocket ?? null,
    getVocabulary: () => broker!.vocabulary(),
    openQuickControls: deps.openQuickControls,
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
    idleMotionSettings: settings.idleMotionSettings,
    vrmSelection,
    register,
  });
  // The refresh re-uploads missing user voices, so it runs on the migrated ids.
  void migrateVoiceIds().finally(refreshVoiceList);
  await loadVrmSerialized(vrmSelection.getActive().url);
  ensureActive();

  return {
    voice,
    dispatcher,
    guardrails,
    pacer,
    setPeek: turnWiring.setPeek,
    setProactiveSource: turnVoice.setProactiveSource,
    setStrolling: turnVoice.setStrolling,
    start: () => dispatcher.start(),
    async connect(hooks) {
      const published = await wireBroker({
        getConfig: config.get,
        getEndpoints,
        endpointsSettings: settings.endpointsSettings,
        expressMotionSettings: settings.expressMotionSettings,
        // The socket advertises the same vocabulary the broker publishes; it diffs before it sends.
        onVocabularyChange: () => pushSocket?.sendVocabulary(),
        log,
      });
      broker = published;
      register(published.dispose);
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
        hooks.onSubmit();
      });
      return { broker: published, stopTurn };
    },
  };
}
