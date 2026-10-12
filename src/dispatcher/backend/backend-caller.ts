/**
 * Backend caller — B1–B5 call sequence.
 *
 * Sends tier2 events to backend judgment. Backend side of the firing≠judgment boundary:
 * Speech decision is based solely on whether speech_text is empty (no separate flag: silence = empty speech_text).
 *
 *  B1 package_context — Assemble InputContext (user_text + env.timestamp + env.timezone).
 *  B2 POST — io/chat-client.streamChat(config, req, { fetch, apiKey }). SSE owned by chat-client
 *     — not parsed directly here. In-flight abort via AbortSignal. idle-gap watchdog
 *     (PRE_SPEECH_TIMEOUT_MS while the last event wasn't speech, SPEECH_IDLE_TIMEOUT_MS once it
 *     was, resetting on each event) aborts stalled calls — normal turns with long thinking/tool
 *     rounds/streaming are not killed.
 *  B3 parse — chat-client's `completed` event already assembled ControlEnvelope.
 *     No completed received → parse_error.
 *  B4 speech gate — speak only when speech_text is not empty. Empty text = silence,
 *     no separate flag. emotion/motion rendered regardless of silence.
 *  B5 dispatch_to_renderer — when per-beat cue streamed, TTS pipeline applies
 *     emotion/motion audio-timed (express→turnOutput.cue), otherwise at completed, and only for an
 *     envelope that carries one of the two channels: renderer.applyDirective(envelope).
 *     speech_text→turnOutput.speak + tool_status→turnFeed (flowed to TTS/UI in app/turn/wire-dispatcher.ts).
 *
 * Silent drop classification: parse_error(WARN) / network_drop(WARN) / network_stall(WARN, idle timeout).
 */

import type {
  BodyState,
  EndpointsConfig,
  FrontmostState,
  InputContext,
  PreviousTurn,
} from "../../contract";
import {
  type ChatHistoryEntry,
  selectSendSuffix,
} from "../../io/chat/conversation/chat-history-store";
import {
  type ChatRequest,
  streamChat,
  type ToolOutputItem,
} from "../../io/chat/stream/chat-client";
import { buildCCMessages } from "../../io/chat/stream/chat-completions";
import type { ClientToolRegistry } from "../../io/chat/stream/client-tools";
import type { Logger } from "../../logger";
import { createLogger } from "../../logger";
import type { Turn } from "../turn/turn";
import { backgroundMarker } from "./background-marker";
import { renderClientContext } from "./client-context-text";
import { buildContext, imageDataUrlsOf, userTextOf } from "./context-builder";
import { withPendingOutputs } from "./pending-tool-outputs";
import { createPushCall, type PushCallDeps } from "./push-call";
import { encodeInput } from "./request-input";
import { createReplySettler, type SettleDeps } from "./settle-reply";
import { type AttemptResult, createStreamAttempt, type StreamAttemptDeps } from "./stream-attempt";
import type { TurnOutcome } from "./turn-outcome";
import { recordSentTurn } from "./turn-recording";

const baseLog = createLogger("backend-caller");

/**
 * Reflex turns are immediate reactions to physical interaction — they skip the TTFT thinking
 * filler, since a deliberative "thinking" bridge before a reflex reaction feels wrong.
 * Client-only render policy; never sent to the backend.
 */
const REFLEX_EVENT_NAMES = new Set([
  "proactive.head_pat",
  "proactive.drag_held",
  "proactive.window_sit",
  "proactive.peek",
  "proactive.dropped",
]);

export function isReflexTurn(eventName: string): boolean {
  return eventName.startsWith("proactive.touch_") || REFLEX_EVENT_NAMES.has(eventName);
}

/**
 * Whether a chat turn has an address to reach. `""` means not configured — a turn settles
 * `not_configured` and the onboarding hint points the user at the settings panel.
 */
export function isChatConfigured(cfg: Pick<EndpointsConfig, "chat_base_url">): boolean {
  return Boolean(cfg.chat_base_url);
}

export type { TurnFailure, TurnOutcome } from "./turn-outcome";

/** Server-side HTTP error detail for a failed turn — bare body message, no wrapper. */
export type TurnErrorDetail = { status: number; message: string };

/** Adds the streaming path's own deps to the sets the push path and the reply settle declare, so each field is declared once. */
interface BackendCallerDeps extends PushCallDeps, SettleDeps, StreamAttemptDeps {
  /** CC mode replays the current session from the transcript. */
  transcript?: NonNullable<PushCallDeps["transcript"]> & {
    entriesAfterLastBoundary(): ChatHistoryEntry[];
  };
  /** Chat backend auth key resolution (SecretProvider). Unauthenticated placeholder if absent. */
  getApiKey: () => Promise<string | undefined>;
  /** Transport fetch selection (selectFetch). Tauri=cors-fetch, dev=undefined. */
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** When toggle is ON, assembles and returns screenshot block (undefined if OFF/failed). main.ts composes with settings+capturer+buildScreenshotBlock. */
  getScreenshot?: () => Promise<InputContext["screenshot"] | undefined>;
  /** Held posture lookup — called per turn. Optional for callers with no dispatcher wired; the real client always provides one. */
  getBodyState?: () => BodyState | undefined;
  /** Latest frontmost sample lookup — called per turn; undefined until a sample exists. */
  getFrontmost?: () => FrontmostState | undefined;
  /** Previous-turn slot lookup — read after the pre-turn interrupt, so a superseded turn is already recorded. */
  getPrevious?: () => PreviousTurn | undefined;
  /** True once, for the user turn whose message woke the character on the launch bed. */
  takeMessageWake?: () => boolean;
  /** Previous response id lookup — when present, included in request to continue conversation. Called per turn (reflects reset/rotation). */
  getPreviousResponseId?: () => string | undefined;
  /** Outputs of the stored response's unanswered tool calls — sent with the id, dropped wherever the id is. */
  getPendingToolOutputs?: () => ToolOutputItem[];
  /** New response id persist, with the outputs its unanswered calls need — called only after a completely successful turn (conversation state progress). */
  onResponseId?: (id: string, toolOutputs: ToolOutputItem[]) => void;
  /** Stored previous_response_id invalidation sink — called once when a 404 chain-break is detected, before the retry. */
  onResponseIdInvalid?: () => void;
  /** Chain-break UI notice sink — called once alongside onResponseIdInvalid so the user sees the context reset. */
  onChainReset?: () => void;
  /** Current agent setting (reasoning effort + instructions override) snapshot. Reflected in request only when present. */
  getAgentSettings?: () => import("../../settings/backend/agent-settings").AgentSettings;
  /** Client-declared tool registry, resolved per turn so vocabulary edits land on the next call. */
  clientTools?: () => ClientToolRegistry | undefined;
  /** The user typed or spoke, so the push turns still outstanding are stopped with the speech. */
  onPushTurnCut?: () => void;
  /** Structured logging (defaults to backend_caller namespace logger if absent). */
  logger?: Logger;
  /** Chat stream transport. Defaults to the real streamChat; injected in tests to script a turn. */
  stream?: typeof streamChat;
}

export interface BackendCaller {
  /**
   * Execute B1–B5 for one admitted turn. In-flight aborted if externalSignal aborts.
   * Never throws — failures expressed as a TurnOutcome failure value (dispatcher branches).
   * A stream error carrying an HTTP status invokes onErrorDetail with {status, bare server
   * message} before the failure outcome resolves.
   */
  call(
    turn: Turn,
    externalSignal?: AbortSignal,
    onErrorDetail?: (detail: TurnErrorDetail) => void,
  ): Promise<TurnOutcome>;
}

export function createBackendCaller(deps: BackendCallerDeps): BackendCaller {
  const log = deps.logger ?? baseLog;
  const stream = deps.stream ?? streamChat;
  const streamAttempt = createStreamAttempt(deps, log, stream);
  const pushCall = createPushCall(deps, log);
  const replySettler = createReplySettler(deps, log);

  async function call(
    turn: Turn,
    externalSignal?: AbortSignal,
    onErrorDetail?: (detail: TurnErrorDetail) => void,
  ): Promise<TurnOutcome> {
    const env = turn.trigger;
    // Push mode sends the turn on the socket and holds the call open until its first render.
    const isPush = deps.config.chat_api === "push";
    if (externalSignal?.aborted) {
      return "superseded_by_user";
    }

    // Clean up remaining audio/speech bubble from the previous (superseded) turn — once before first delta.
    // In push mode nothing the backend pushes stops speech, so only a turn the user typed or spoke
    // does: it cuts the reply being spoken and the renders still to come for it. This runs before
    // buildContext, which reads the previous-turn record the cut is about to write.
    const userSpoke = userTextOf(env) !== undefined;
    if (!isPush || userSpoke) deps.turnOutput?.interrupt();
    if (isPush && userSpoke) deps.onPushTurnCut?.();

    // TTFT thinking — when filler is active, start immediately on call() entry (not judgment, first line no delay).
    // End once on actual response speech start (first speech_delta) — usage/express/tool_status before don't
    // break thinking. Silence/error/abort turns guaranteed end by finally.
    // call() may overlap turns, so keep state per-invocation local (never closure/module scope).
    let thinkingStarted = false;
    let thinkingDone = false;
    // Everything this call feeds the shared turn feed carries this owner, so a superseded
    // call's late frames cannot touch a newer turn's chip or cycle.
    const owner = `stream:${turn.id}`;
    const startThinking = () => {
      if (thinkingStarted || thinkingDone) return;
      thinkingStarted = true;
      deps.turnOutput?.thinkingStart(turn.id);
    };
    const endThinking = () => {
      if (thinkingDone) return;
      thinkingDone = true;
      if (thinkingStarted) deps.turnOutput?.thinkingEnd(turn.id);
    };

    // Session this turn belongs to — compared again before the transcript append (R2): a reset
    // landing mid-flight opens a new session, and this turn must not contribute to it.
    const startSessionToken = deps.transcript?.sessionToken();

    // Wrap entire span in try/finally — thinking end guaranteed exactly once on any exit path
    // (setup reject, early abort, stream throw, post-loop abort, streamError, empty/parse_error,
    // normal completion all covered).
    try {
      // No chat backend configured — settle before any context/network work so the UI can point
      // the user at the settings panel instead of showing a generic connection failure.
      if (!isChatConfigured(deps.config)) {
        log.warn("not_configured", { event_name: env.event_name, missing: "chat_base_url" });
        return "not_configured";
      }
      // If filler is active, show first line immediately (synchronous start). Don't start if disabled/pool empty,
      // or on a reflex turn — a "thinking" bridge before an immediate reaction reads as dissonant.
      if (deps.turnOutput?.hasFiller() && !isReflexTurn(env.event_name)) {
        startThinking();
      }
      // B1
      const { ctx, clientContext } = await buildContext(env, {
        getScreenshot: deps.getScreenshot,
        getBodyState: deps.getBodyState,
        getFrontmost: deps.getFrontmost,
        getPrevious: deps.getPrevious,
        takeMessageWake: deps.takeMessageWake,
        onScreenshotError: (error) => log.warn("screenshot.failed", { error: String(error) }),
      });
      // Single "now" snapshot reused for every duration computed into this turn's rendered
      // client_context (Responses input and CC system message alike) so both stay consistent.
      const nowMs = Date.now();

      if (isPush) {
        return await pushCall.send({
          turn,
          env,
          ctx,
          clientContext,
          nowMs,
          startSessionToken,
          endThinking,
          externalSignal,
        });
      }

      const input = encodeInput(ctx, env, clientContext, nowMs);
      log.debug("backend_call", { event_name: env.event_name, seq_id: env.seq_id });

      // B2: After resolving fetch/apiKey, streamChat. Pass externalSignal as-is (delegate abort).
      let apiKey: string | undefined;
      let fetchImpl: typeof globalThis.fetch | undefined;
      try {
        [apiKey, fetchImpl] = await Promise.all([deps.getApiKey(), deps.getFetch()]);
      } catch (err) {
        log.warn("network_drop", { stage: "setup", error: String(err) });
        return "network_drop";
      }

      if (externalSignal?.aborted) {
        return "superseded_by_user";
      }

      // Clean up in-flight fetch via AbortController. Link external signal (dispatcher's
      // supersede abort) to internal controller so always pass single signal to streamChat.
      const ac = new AbortController();
      if (externalSignal) {
        if (externalSignal.aborted) ac.abort();
        else externalSignal.addEventListener("abort", () => ac.abort(), { once: true });
      }
      const request: ChatRequest = { input, signal: ac.signal };
      const isCC = deps.config.chat_api === "chat_completions";

      // Apply agent settings: reasoning_effort always sent in both modes.
      const agent = deps.getAgentSettings?.();
      if (agent) request.reasoning_effort = agent.reasoning_effort;

      // Snapshot previous response id into request — preserve start value to detect reset on completion (R2).
      // CC mode has no server-side conversation state (stitched by transcript) — skip snapshot/persist.
      let startPreviousResponseId: string | undefined;
      if (isCC) {
        const effectiveInstructions = agent?.instructions.trim()
          ? agent.instructions
          : deps.config.chat_instructions;
        const ccTranscript = selectSendSuffix(
          deps.transcript?.entriesAfterLastBoundary() ?? [],
          deps.config.chat_model_context_window,
        );
        const imageDataUrls = imageDataUrlsOf(ctx);
        request.messages = buildCCMessages({
          ...(effectiveInstructions ? { instructions: effectiveInstructions } : {}),
          clientContextText: renderClientContext(clientContext, nowMs),
          transcript: ccTranscript,
          userText: ctx.user_text ?? backgroundMarker(env.event_name, clientContext.trigger),
          ...(imageDataUrls.length ? { imageDataUrls } : {}),
        });
      } else {
        startPreviousResponseId = deps.getPreviousResponseId?.();
        if (startPreviousResponseId) {
          request.previous_response_id = startPreviousResponseId;
          request.input = withPendingOutputs(input, deps.getPendingToolOutputs?.() ?? []);
        }
        // Empty instructions omitted for config fallback.
        if (agent?.instructions.trim()) request.instructions = agent.instructions;
      }

      // Tools declared for this turn on both request transports.
      const clientTools = deps.clientTools?.();

      // Chain-break 404 recovery: retry at most once, so this flips true before the retry attempt.
      let chainBreakRetried = false;
      let attempted: AttemptResult;
      // Attempt loop: body runs once, `continue`s exactly once on a 404 chain-break, then always exits via break/return.
      while (true) {
        attempted = await streamAttempt.run({
          turn,
          owner,
          externalSignal,
          abort: () => ac.abort(),
          request,
          // Built per attempt: a stream may keep or mutate its options object.
          streamOpts: {
            apiKey,
            fetch: fetchImpl,
            ...(clientTools ? { tools: clientTools } : {}),
          },
          endThinking,
        });
        if (attempted.kind === "drop") return attempted.outcome;
        if (attempted.kind === "stream_error") {
          // Chain break: previous_response_id points at a response the backend no longer holds
          // (server-side conversation state lost/expired). Retry once without it, but only if
          // nothing streamed yet this attempt — a partial reply already rendered can't be resent.
          if (
            !chainBreakRetried &&
            attempted.status === 404 &&
            startPreviousResponseId &&
            !attempted.streamedAny
          ) {
            chainBreakRetried = true;
            log.warn("chain_break_404", {
              status: attempted.status,
              message: attempted.message,
              previous_response_id: startPreviousResponseId,
            });
            deps.onResponseIdInvalid?.();
            deps.onChainReset?.();
            delete request.previous_response_id;
            request.input = input;
            startPreviousResponseId = undefined;
            continue;
          }
          log.warn("network_drop", {
            stage: "stream_error",
            message: attempted.message,
            status: attempted.status,
          });
          // Server answered with an HTTP error — carry its status + message to the UI surface.
          if (attempted.status !== undefined) {
            onErrorDetail?.({ status: attempted.status, message: attempted.message });
          }
          return "network_drop";
        }
        break;
      }
      const { envelope, newResponseId, toolOutputs, streamedAny, cueStreamed } = attempted;

      const spokeText = replySettler.settle({
        turnId: turn.id,
        envelope,
        streamedAny,
        cueStreamed,
        getEventName: () => env.event_name,
      });

      // Conversation state progress (Responses only): persist only at this point after passing all
      // post-stream guards (abort / streamError / !envelope). Only when start-time id unchanged —
      // if reset/rotation (R2) occurred in-flight, don't revive that new state from dead response. CC mode
      // skips snapshot/persist entirely.
      if (!isCC && newResponseId && deps.getPreviousResponseId?.() === startPreviousResponseId) {
        deps.onResponseId?.(newResponseId, toolOutputs ?? []);
      }

      // Recorded in both modes only (successful turn passing all post-stream guards).
      recordSentTurn(deps, log, {
        eventName: env.event_name,
        userText: ctx.user_text,
        clientContext,
        startSessionToken,
        assistantText: envelope.speech_text,
        spokeText,
      });

      return "ok";
    } finally {
      endThinking();
      // A cycle this call opened or a running tool it never closed dies with it, on every exit
      // path (abort·drop·stall) — another owner's slots are left alone.
      deps.turnFeed?.ended(owner);
    }
  }

  return { call };
}
