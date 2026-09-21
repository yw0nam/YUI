/** Wires the turn feed, the backend caller, guardrails, the pacer and the dispatcher. */
import { type AppConfig, CHAT_API_KEY_SECRET } from "../../config/load";
import type { EndpointsConfig, FrontmostState, ToolStatus } from "../../contract";
import { createBackendCaller } from "../../dispatcher/backend/backend-caller";
import type { PreviousTurnSlot } from "../../dispatcher/backend/previous-turn";
import type { EventBus } from "../../dispatcher/core/event-bus";
import {
  createGuardrails,
  type Guardrails,
  type GuardrailsConfig,
} from "../../dispatcher/core/guardrails";
import { createProactivePacer, type ProactivePacer } from "../../dispatcher/core/proactive-pacer";
import { createDispatcher, type Dispatcher } from "../../dispatcher/dispatcher";
import type { PushTurns } from "../../dispatcher/turn/push-turn";
import type { TurnLog } from "../../dispatcher/turn/turn";
import { createTurnFeed, type TurnFeed } from "../../dispatcher/turn/turn-feed";
import type { ReasoningStore } from "../../io/bridge/reasoning-store";
import type { BrokerPayload } from "../../io/chat/broker-client";
import { createClientToolRegistry, createGenerateExpressTool } from "../../io/chat/client-tools";
import type { PushSocket } from "../../io/chat/push-socket";
import type { PacerSkipRecord, TurnRecord } from "../../io/chat/turn-record-log";
import type { SettingsStores } from "../../io/settings/settings-stores";
import type { ScreenCapturer } from "../../io/window/capture/screen-source-provider";
import { buildScreenshotBlock } from "../../io/window/capture/screenshot-context";
import type { Renderer } from "../../renderer";
import { showChainResetNotice } from "../../ui/notices/chain-reset-notice";
import {
  routeTurnFailure,
  turnErrorFixAction,
  turnErrorMessage,
} from "../../ui/notices/turn-error";
import type { QuickControlsTab } from "../../ui/quick-controls/constants";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { wireGuardrailsOverrides } from "../cross-window/wire-window-sync";
import type { VoicePipeline } from "./wire-voice-pipeline";

export function wireDispatcher(deps: {
  bus: EventBus;
  renderer: Renderer;
  surfaces: Pick<
    Surfaces,
    | "showTool"
    | "finishTool"
    | "hideTool"
    | "setBusy"
    | "showInputError"
    | "isInputOpen"
    | "beginSpeech"
    | "pushSpeech"
    | "endSpeech"
  >;
  reasoning: Pick<ReasoningStore, "append" | "finish" | "interrupt">;
  getEndpoints: () => EndpointsConfig;
  getGuardrails: () => GuardrailsConfig;
  getConfig: () => AppConfig;
  getSecret: (name: string) => Promise<string | undefined>;
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  sessionStore: SettingsStores["sessionStore"];
  sessionDiagnostics: SettingsStores["sessionDiagnostics"];
  chatHistoryStore: SettingsStores["chatHistoryStore"];
  contextHistory: SettingsStores["contextHistory"];
  agentSettings: SettingsStores["agentSettings"];
  guardrailsSettings: SettingsStores["guardrailsSettings"];
  pacerGapSettings: SettingsStores["pacerGapSettings"];
  screenshotSettings: SettingsStores["screenshotSettings"];
  screenCapturer: ScreenCapturer;
  getFrontmost: () => FrontmostState | undefined;
  voice: Pick<VoicePipeline, "turnOutput" | "speakFailure">;
  turnLog: TurnLog;
  previousTurn: PreviousTurnSlot;
  pushTurns: PushTurns;
  pushSocket: PushSocket | null;
  getVocabulary: () => BrokerPayload;
  openQuickControls: (tab: QuickControlsTab) => void;
  showVoiceError: (reason: string) => void;
  appendTurnRecord: (record: TurnRecord | PacerSkipRecord) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  register: (teardown: () => void) => void;
}): {
  dispatcher: Dispatcher;
  guardrails: Guardrails;
  pacer: ProactivePacer;
  turnFeed: TurnFeed;
  setPeek(peek: { enter(): Promise<void>; exit(): Promise<void> }): void;
} {
  const {
    bus,
    renderer,
    surfaces,
    reasoning,
    getEndpoints,
    getGuardrails,
    getConfig,
    getSecret,
    getFetch,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    contextHistory,
    agentSettings,
    guardrailsSettings,
    pacerGapSettings,
    screenshotSettings,
    screenCapturer,
    getFrontmost,
    voice,
    turnLog,
    previousTurn,
    pushTurns,
    pushSocket,
    getVocabulary,
    openQuickControls,
    showVoiceError,
    appendTurnRecord,
    t,
    register,
  } = deps;

  const applyToolStatus = (status: ToolStatus): void => {
    if (status.state === "running") surfaces.showTool(status.tool_id ?? "");
    else if (status.state === "done") surfaces.finishTool();
    else surfaces.hideTool();
  };
  // One feed for both transports, so a transport's frames never reach the chip or the
  // reasoning store without an owner naming the turn they belong to.
  const turnFeed = createTurnFeed({ onToolStatus: applyToolStatus, reasoning });

  const backendCaller = createBackendCaller({
    get config() {
      return getEndpoints();
    },
    renderer,
    getApiKey: () => getSecret(CHAT_API_KEY_SECRET),
    getFetch,
    getPreviousResponseId: () => sessionStore.get() ?? undefined,
    onResponseId: (id) => sessionStore.set(id),
    onResponseIdInvalid: () => sessionStore.clear(),
    onChainReset: () => showChainResetNotice({ surfaces, t }),
    transcript: chatHistoryStore,
    onUsage: (usage) => {
      sessionDiagnostics.setUsage(
        usage.total_tokens,
        getEndpoints().chat_model_context_window ?? null,
      );
    },
    turnOutput: voice.turnOutput,
    reportSpokeText: (spoke) => turnLog.setSpokeText(spoke),
    turnFeed,
    getScreenshot: async () => {
      const screenshot = screenshotSettings.get();
      if (!screenshot.enabled) return undefined;
      const capture = await screenCapturer.capture(screenshot.source);
      return buildScreenshotBlock(screenshot, capture ?? undefined);
    },
    getBodyState: () => dispatcher.getBodyState(),
    getFrontmost,
    getPrevious: previousTurn.get,
    contextHistory,
    appendTurnRecord,
    getAgentSettings: () => agentSettings.get(),
    // Built per turn from the published vocabulary, so a live edit reaches the next tool schema.
    clientTools: () => createClientToolRegistry([createGenerateExpressTool(getVocabulary())]),
    pushTurn: (frame) => pushSocket?.sendTurn(frame) ?? false,
    onPushTurnCut: () => pushTurns.cut(),
    onPushTurnSent: (turnId) => pushTurns.opened(turnId),
    pushTurns,
    onPushSocketNotReady: (cb) =>
      pushSocket?.onState((state) => {
        if (state.kind !== "ready") cb();
      }) ?? (() => {}),
  });
  const guardrails = createGuardrails(getGuardrails());
  const pacer = createProactivePacer({ getIntervalMs: () => pacerGapSettings.get().value });
  register(pacer.stop);
  register(pacerGapSettings.subscribe(() => pacer.noteIntervalChanged()));
  register(wireGuardrailsOverrides({ guardrails, store: guardrailsSettings, getGuardrails }));
  // Dispatcher creation precedes peek wiring, so peek callbacks stay late-bound across that cycle.
  let peekRef: { enter(): Promise<void>; exit(): Promise<void> } | null = null;
  const dispatcher = createDispatcher({
    bus,
    renderer,
    backendCaller,
    guardrails,
    peek: {
      enter: () => peekRef?.enter() ?? Promise.resolve(),
      exit: () => peekRef?.exit() ?? Promise.resolve(),
    },
    peekConfig: () => getConfig().avatar.peek,
    tapConfig: () => getConfig().avatar.tap,
    turnLog,
    hasOutstandingSpeech: () => voice.turnOutput.hasOutstandingSpeech(),
    pacer,
    appendSkipRecord: appendTurnRecord,
    onTurnFailed: previousTurn.callFailed,
    onUserTurnFailed: (reason, source) => {
      voice.speakFailure(reason);
      const message = turnErrorMessage(reason);
      if (!message) return;
      const action = routeTurnFailure(source, surfaces.isInputOpen());
      if (action.kind === "show_input_error") {
        surfaces.showInputError(message, turnErrorFixAction(reason, openQuickControls));
      } else if (action.kind === "voice_error") {
        showVoiceError(reason);
      }
    },
  });
  register(() => dispatcher.stop());
  register(dispatcher.subscribeBusy((busy) => surfaces.setBusy(busy)));

  return {
    dispatcher,
    guardrails,
    pacer,
    turnFeed,
    setPeek(peek) {
      peekRef = peek;
    },
  };
}
