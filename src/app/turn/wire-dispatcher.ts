/** Wires the turn feed, the backend caller, guardrails, the pacer and the dispatcher. */
import type { AppConfig } from "../../config/load";
import { CHAT_API_KEY_SECRET } from "../../config/secrets";
import type { EndpointsConfig, FrontmostState, ToolStatus, Usage } from "../../contract";
import { createBackendCaller } from "../../dispatcher/backend/backend-caller";
import type { PreviousTurnSlot } from "../../dispatcher/backend/previous-turn";
import type { EventBus } from "../../dispatcher/core/event-bus";
import {
  createGuardrails,
  type Guardrails,
  type GuardrailsConfig,
} from "../../dispatcher/core/guardrails";
import { createProactivePacer, type ProactivePacer } from "../../dispatcher/core/proactive-pacer";
import { createTurnGate } from "../../dispatcher/core/turn-gate";
import { createDispatcher, type Dispatcher } from "../../dispatcher/dispatcher";
import type { PushTurns } from "../../dispatcher/turn/push-turn";
import type { QuotedTurn } from "../../dispatcher/turn/quoted-turn";
import type { TurnLog } from "../../dispatcher/turn/turn";
import { createTurnFeed, type TurnFeed } from "../../dispatcher/turn/turn-feed";
import type { ReasoningStore } from "../../io/bridge/reasoning/reasoning-store";
import { clientToolsUnlessBrokered } from "../../io/chat/broker/broker-tool-owner";
import { readTranscriptAfterBoundary } from "../../io/chat/conversation/chat-history-store";
import { createOverheardReader } from "../../io/chat/conversation/overheard/overheard-reader";
import type { PushSocket } from "../../io/chat/push/push-socket";
import type { PacerSkipRecord, TurnRecord } from "../../io/chat/record/turn-record-log";
import {
  type ClientTool,
  createClientToolRegistry,
  createClientTools,
} from "../../io/chat/tools/client-tools";
import type { ExpressVocabulary } from "../../io/chat/vocabulary/express-vocabulary";
import type { ScreenCapturer } from "../../io/window/capture/screen-source-provider";
import { buildScreenshotBlock } from "../../io/window/capture/screenshot-context";
import type { Renderer } from "../../renderer";
import { presetIdForWindow, readPresetName } from "../../settings/preset/active-preset";
import { readOpenPresetIds } from "../../settings/preset/pet-windows";
import type { SettingsStores } from "../../settings/settings-stores";
import { showChainResetNotice } from "../../ui/notices/chain-reset-notice";
import {
  routeTurnFailure,
  turnErrorFixAction,
  turnErrorMessage,
} from "../../ui/notices/turn-error";
import type { QuickControlsTab } from "../../ui/quick-controls/constants";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { wireGuardrailsOverrides } from "../cross-window/wire-window-sync";
import type { ConversationStores } from "../settings/conversation-stores";
import type { VoicePipeline } from "./voice/wire-voice-pipeline";

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
  sessionStore: ConversationStores["sessionStore"];
  /** The session readout's usage consumer, shared with the push transport. */
  onUsage: (usage: Usage) => void;
  chatHistoryStore: ConversationStores["chatHistoryStore"];
  contextHistory: ConversationStores["contextHistory"];
  overheardStore: ConversationStores["overheardStore"];
  agentSettings: SettingsStores["agentSettings"];
  guardrailsSettings: SettingsStores["guardrailsSettings"];
  pacerGapSettings: SettingsStores["pacerGapSettings"];
  oneVoiceSettings: SettingsStores["oneVoiceSettings"];
  screenshotSettings: SettingsStores["screenshotSettings"];
  screenCapturer: ScreenCapturer;
  getFrontmost: () => FrontmostState | undefined;
  /** True once, for the user turn whose message woke the character on the bed. */
  takeMessageWake?: () => boolean;
  /** True while a scene holds the body: a turn that starts then shows no thinking bridge. */
  isBodyHeld?: () => boolean;
  voice: Pick<VoicePipeline, "turnOutput" | "speakFailure">;
  turnLog: TurnLog;
  previousTurn: PreviousTurnSlot;
  quotedTurn: Pick<QuotedTurn, "admitted" | "failed">;
  pushTurns: PushTurns;
  pushSocket: PushSocket | null;
  getVocabulary: () => ExpressVocabulary;
  /** The tools this window declares beside generate_express; empty outside Tauri. */
  windowTools?: readonly ClientTool[];
  openQuickControls?: (tab: QuickControlsTab) => void;
  showVoiceError: (reason: string, message?: string) => void;
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
    onUsage,
    chatHistoryStore,
    contextHistory,
    overheardStore,
    agentSettings,
    guardrailsSettings,
    pacerGapSettings,
    oneVoiceSettings,
    screenshotSettings,
    screenCapturer,
    getFrontmost,
    takeMessageWake,
    isBodyHeld,
    voice,
    turnLog,
    previousTurn,
    quotedTurn,
    pushTurns,
    pushSocket,
    getVocabulary,
    windowTools,
    openQuickControls,
    showVoiceError,
    appendTurnRecord,
    t,
    register,
  } = deps;

  const applyToolStatus = (status: ToolStatus): void => {
    if (status.state === "running") surfaces.showTool(status.tool_id ?? "");
    else if (status.state === "done" || status.state === "failed")
      surfaces.finishTool(status.state === "failed");
    else surfaces.hideTool();
  };
  // One feed for both transports, so a transport's frames never reach the chip or the
  // reasoning store without an owner naming the turn they belong to.
  const turnFeed = createTurnFeed({ onToolStatus: applyToolStatus, reasoning });

  // Built per turn from the published vocabulary, so a live edit reaches the next tool schema.
  const turnTools = () =>
    clientToolsUnlessBrokered(
      getEndpoints(),
      createClientToolRegistry(createClientTools(getVocabulary(), windowTools)),
    );

  const overheard = createOverheardReader({
    selfPresetId: presetIdForWindow(),
    otherPresetIds: readOpenPresetIds,
    presetName: readPresetName,
    transcriptOf: readTranscriptAfterBoundary,
    cursors: overheardStore,
  });

  const backendCaller = createBackendCaller({
    get config() {
      return getEndpoints();
    },
    renderer,
    getApiKey: () => getSecret(CHAT_API_KEY_SECRET),
    getFetch,
    getPreviousResponseId: () => sessionStore.get() ?? undefined,
    getPendingToolOutputs: () => sessionStore.outputs(),
    onResponseId: (id, outputs) => sessionStore.set(id, outputs),
    onResponseIdInvalid: () => sessionStore.clear(),
    onChainReset: () => showChainResetNotice({ surfaces, t }),
    transcript: chatHistoryStore,
    onUsage,
    turnOutput: voice.turnOutput,
    reportSpokeText: (turnId, spoke) => turnLog.setSpokeText(turnId, spoke),
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
    getToolSwitches: () => turnTools()?.switches() ?? [],
    takeMessageWake,
    getOverheard: overheard.read,
    commitOverheard: overheard.commit,
    isBodyHeld,
    contextHistory,
    appendTurnRecord,
    getAgentSettings: () => agentSettings.get(),
    clientTools: turnTools,
    pushTurn: (frame) => pushSocket?.sendTurn(frame) ?? false,
    pushImageRoom: (frame) => pushSocket?.imageRoom(frame),
    onPushTurnCut: () => pushTurns.cut(),
    onPushTurnSent: pushTurns.opened,
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
    turnGate: createTurnGate({ enabled: () => oneVoiceSettings.get().enabled }),
    hasOutstandingSpeech: () => voice.turnOutput.hasOutstandingSpeech(),
    pacer,
    appendSkipRecord: appendTurnRecord,
    onTurnAdmitted: quotedTurn.admitted,
    onTurnFailed: (turn, reason) => {
      previousTurn.callFailed(turn, reason);
      quotedTurn.failed(turn);
    },
    onUserTurnFailed: (reason, source, detail) => {
      voice.speakFailure(reason);
      const message = turnErrorMessage(reason, detail);
      if (!message) return;
      const action = routeTurnFailure(source, surfaces.isInputOpen());
      if (action.kind === "show_input_error") {
        surfaces.showInputError(message, turnErrorFixAction(reason, openQuickControls));
      } else if (action.kind === "voice_error") {
        showVoiceError(reason, detail ? message : undefined);
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
