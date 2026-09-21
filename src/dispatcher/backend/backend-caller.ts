/**
 * Backend caller — B1–B5 call sequence.
 *
 * Sends tier2/3 events to backend judgment. Backend side of the firing≠judgment boundary:
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
 *     emotion/motion audio-timed (express→turnOutput.cue), otherwise at completed: renderer.applyDirective(envelope).
 *     speech_text→turnOutput.speak + tool_status→turnFeed (flowed to TTS/UI in app/bootstrap-configured.ts).
 *
 * Silent drop classification: parse_error(WARN) / network_drop(WARN) / network_stall(WARN, idle timeout).
 */

import type {
  BodyState,
  ControlEnvelope,
  EndpointsConfig,
  FrontmostState,
  InputContext,
  PreviousTurn,
  Usage,
} from "../../contract";
import { type ChatRequest, streamChat } from "../../io/chat/chat-client";
import { buildCCMessages } from "../../io/chat/chat-completions";
import { selectSendSuffix } from "../../io/chat/chat-history-store";
import type { ClientToolRegistry } from "../../io/chat/client-tools";
import { createSilenceTokenFilter, isSilenceToken } from "../../io/chat/silence-token";
import { buildTurnRecord } from "../../io/chat/turn-record-log";
import type { Logger } from "../../logger";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { Turn } from "../turn/turn";
import type { TurnFeed } from "../turn/turn-feed";
import { backgroundMarker } from "./background-marker";
import { renderClientContext } from "./client-context-text";
import { buildContext, imageDataUrlsOf, userTextOf } from "./context-builder";
import {
  PRE_SPEECH_TIMEOUT_MS,
  SPEECH_IDLE_TIMEOUT_MS,
  type StallStage,
  withIdleWatchdog,
} from "./idle-watchdog";
import { createPushCall, type PushCallDeps } from "./push-call";
import { encodeInput } from "./request-input";
import type { TurnOutcome } from "./turn-outcome";

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

/** Adds the streaming path's own deps to the set the push path declares, so each field is declared once. */
interface BackendCallerDeps extends PushCallDeps {
  /** chat endpoint config. */
  config: EndpointsConfig;
  /** render directive sink (applyDirective). */
  renderer: Pick<Renderer, "applyDirective">;
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
  /** The shared tool-chip/reasoning consumer — the streaming path feeds it under this turn's owner. */
  turnFeed?: TurnFeed;
  /** Previous response id lookup — when present, included in request to continue conversation. Called per turn (reflects reset/rotation). */
  getPreviousResponseId?: () => string | undefined;
  /** New response id persist — called only after a completely successful turn (conversation state progress). */
  onResponseId?: (id: string) => void;
  /** Stored previous_response_id invalidation sink — called once when a 404 chain-break is detected, before the retry. */
  onResponseIdInvalid?: () => void;
  /** Chain-break UI notice sink — called once alongside onResponseIdInvalid so the user sees the context reset. */
  onChainReset?: () => void;
  /** usage (token occupancy) sink — called only when present. Diagnostic channel independent of ControlEnvelope. */
  onUsage?: (usage: Usage) => void;
  /** Current agent setting (reasoning effort + instructions override) snapshot. Reflected in request only when present. */
  getAgentSettings?: () => import("../../io/settings/agent-settings").AgentSettings;
  /** Client-declared tool registry, resolved per turn so vocabulary edits land on the next call. */
  clientTools?: () => ClientToolRegistry;
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
   */
  call(turn: Turn, externalSignal?: AbortSignal): Promise<TurnOutcome>;
}

export function createBackendCaller(deps: BackendCallerDeps): BackendCaller {
  const log = deps.logger ?? baseLog;
  const stream = deps.stream ?? streamChat;
  const pushCall = createPushCall(deps, log);

  async function call(turn: Turn, externalSignal?: AbortSignal): Promise<TurnOutcome> {
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
      // If filler is active, show first line immediately (synchronous start). Don't start if disabled/pool empty,
      // or on a reflex turn — a "thinking" bridge before an immediate reaction reads as dissonant.
      if (deps.turnOutput?.hasFiller() && !isReflexTurn(env.event_name)) {
        startThinking();
      }

      // No chat backend configured — settle before any context/network work so the UI can point
      // the user at the settings panel instead of showing a generic connection failure.
      if (!isChatConfigured(deps.config)) {
        log.warn("not_configured", { event_name: env.event_name, missing: "chat_base_url" });
        return "not_configured";
      }

      // B1
      const { ctx, clientContext } = await buildContext(env, {
        getScreenshot: deps.getScreenshot,
        getBodyState: deps.getBodyState,
        getFrontmost: deps.getFrontmost,
        getPrevious: deps.getPrevious,
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
        if (startPreviousResponseId) request.previous_response_id = startPreviousResponseId;
        // Empty instructions omitted for config fallback.
        if (agent?.instructions.trim()) request.instructions = agent.instructions;
      }

      // Tools declared for this turn (CC mode; the Responses branch ignores them).
      const clientTools = deps.clientTools?.();

      // B3: Receive ControlEnvelope from chat-client's completed event (no SSE re-parsing).
      let envelope: ControlEnvelope | undefined;
      let newResponseId: string | undefined;
      // Streaming speech: did at least one delta arrive (completion drives turnOutput.end branching).
      let streamedAny = false;
      // Did at least one express cue arrive during stream (completion drives pipeline ownership branching).
      let cueStreamed = false;
      // Holds back the stream head until a bare [SILENT] token can be ruled out — re-created per attempt.
      let silenceFilter = createSilenceTokenFilter();
      // Chain-break 404 recovery: retry at most once, so this flips true before the retry attempt.
      let chainBreakRetried = false;
      // Attempt loop: body runs once, `continue`s exactly once on a 404 chain-break, then always exits via break/return.
      while (true) {
        envelope = undefined;
        newResponseId = undefined;
        streamedAny = false;
        cueStreamed = false;
        silenceFilter = createSilenceTokenFilter();
        // The previous attempt's cycle and running tool die before this one streams.
        deps.turnFeed?.ended(owner);
        let streamError: string | undefined;
        // HTTP status carried by stream error event (openai SDK APIError.status) — distinguish
        // 401/403 as http_4xx_drop (auth-ish) instead of network_drop.
        let streamErrorStatus: number | undefined;
        // Which watchdog budget expired and aborted, if any (undefined = no stall).
        let stallStage: StallStage | undefined;
        try {
          for await (const ev of withIdleWatchdog(
            stream(deps.config, request, {
              apiKey,
              fetch: fetchImpl,
              ...(clientTools ? { tools: clientTools } : {}),
            }),
            { preSpeech: PRE_SPEECH_TIMEOUT_MS, speechIdle: SPEECH_IDLE_TIMEOUT_MS },
            (stage) => {
              stallStage = stage;
              ac.abort();
            },
            (ev) => ev.type === "speech_delta" || ev.type === "speech_done",
          )) {
            if (externalSignal?.aborted) break;
            switch (ev.type) {
              case "speech_delta": {
                // Actual response speech start — end thinking only here (thinkingDone ensures only first delta).
                // usage/express/tool_status before don't break thinking.
                endThinking();
                // A bare [SILENT] token stays held in the filter — only real speech reaches the bubble.
                const speech = silenceFilter.push(ev.text);
                if (speech) {
                  deps.turnOutput?.delta(speech);
                  streamedAny = true;
                }
                break;
              }
              case "express":
                // Pass the entire cue as-is — TTS pipeline applies audio-timed at sentence playback.
                deps.turnOutput?.cue(ev.args);
                deps.turnOutput?.activity(turn.id);
                cueStreamed = true;
                break;
              case "usage":
                // Diagnostic channel independent of ControlEnvelope/renderer — passes to sink only.
                deps.onUsage?.(ev.usage);
                break;
              case "tool_status":
                // Native tool observation result — pass immediately on streaming to show running chip.
                // Do not call endThinking: tool_status does not break thinking.
                log.debug("tool_status", { state: ev.status.state, tool_id: ev.status.tool_id });
                deps.turnFeed?.toolStatus(owner, ev.status.state, ev.status.tool_id);
                deps.turnOutput?.toolStatus(turn.id, ev.status.state, ev.status.tool_id);
                break;
              case "reasoning":
                deps.turnFeed?.reasoning(owner, ev.delta);
                break;
              case "completed":
                envelope = ev.envelope;
                newResponseId = ev.responseId || undefined;
                deps.turnFeed?.replied(owner);
                break;
              case "error":
                streamError = ev.message;
                streamErrorStatus = ev.status;
                break;
              default:
                break;
            }
          }
        } catch (err) {
          // If abort, supersede (next turn cleans up), otherwise network drop — if delta arrived, clean up speech bubble/audio.
          if (externalSignal?.aborted) {
            return "superseded_by_user";
          }
          if (streamedAny) deps.turnOutput?.abort();
          log.warn("network_drop", { stage: "stream_threw", error: String(err) });
          return "network_drop";
        }

        // Ahead of the stall branch: a superseded turn whose stream hangs rather than rejecting
        // would otherwise tear down the pipeline the next turn already owns.
        if (externalSignal?.aborted) {
          return "superseded_by_user";
        }

        if (stallStage) {
          // Nothing landed inside the budget for this phase — stalled.
          if (streamedAny) deps.turnOutput?.abort();
          log.warn("network_stall", {
            stage: stallStage,
            idle_ms:
              stallStage === "pre_speech_timeout" ? PRE_SPEECH_TIMEOUT_MS : SPEECH_IDLE_TIMEOUT_MS,
          });
          return "network_stall";
        }

        if (streamError) {
          // If delta arrived, clean up speech bubble/audio — prevent getting stuck forever without next turn.
          if (streamedAny) deps.turnOutput?.abort();
          // Distinguish auth-ish (401/403) status as http_4xx_drop — keep other 4xx/5xx/no-status as network_drop.
          if (streamErrorStatus === 401 || streamErrorStatus === 403) {
            log.warn("http_4xx_drop", {
              stage: "stream_error",
              status: streamErrorStatus,
              message: streamError,
            });
            return "http_4xx_drop";
          }
          // Chain break: previous_response_id points at a response the backend no longer holds
          // (server-side conversation state lost/expired). Retry once without it, but only if
          // nothing streamed yet this attempt — a partial reply already rendered can't be resent.
          if (
            !chainBreakRetried &&
            streamErrorStatus === 404 &&
            startPreviousResponseId &&
            !streamedAny
          ) {
            chainBreakRetried = true;
            log.warn("chain_break_404", {
              status: streamErrorStatus,
              message: streamError,
              previous_response_id: startPreviousResponseId,
            });
            deps.onResponseIdInvalid?.();
            deps.onChainReset?.();
            delete request.previous_response_id;
            startPreviousResponseId = undefined;
            continue;
          }
          log.warn("network_drop", {
            stage: "stream_error",
            message: streamError,
            status: streamErrorStatus,
          });
          return "network_drop";
        }

        if (!envelope) {
          // No completed received = broken/empty response.
          // If delta arrived, clean up speech bubble/audio — a half-spoken turn would otherwise stay open.
          if (streamedAny) deps.turnOutput?.abort();
          log.warn("parse_error", { event_name: env.event_name });
          return "parse_error";
        }

        break;
      }

      // A head the stream ended on before it could diverge is either a bare [SILENT]
      // (dropped) or a partial prefix cut short (spoken as-is).
      const rest = silenceFilter.flush();
      if (rest) {
        deps.turnOutput?.delta(rest);
        streamedAny = true;
      }

      // B5 (render half): when per-beat cue streamed and speech present (streamedAny), TTS pipeline
      //   applies cue audio-timed at sentence playback — don't double-apply here.
      //   Otherwise (no cue, or cue but silent turn), apply once at completed:
      //   firing≠judgment — silent-turn-with-cue still renders emotion/motion,
      //   and completed-only backend without express streaming is preserved.
      const pipelineOwnsCues = cueStreamed && streamedAny;
      if (pipelineOwnsCues) {
        log.debug("dispatch_to_renderer", {
          owner: "pipeline",
          emotion: envelope.emotion ?? null,
          motion: envelope.motion ?? null,
        });
      } else {
        try {
          deps.renderer.applyDirective(envelope);
          log.debug("dispatch_to_renderer", {
            owner: "completed",
            emotion: envelope.emotion ?? null,
            motion: envelope.motion ?? null,
          });
        } catch (err) {
          // Renderer error → ambient fallback is renderer's responsibility, dispatcher continues.
          log.error("dispatch_to_renderer.error", { error: String(err) });
        }
      }

      // Completed path only: no per-beat cue carried the voice channels, so route them through
      // the same cue channel here — emotion_id/motion_id omitted, applyDirective above already
      // rendered them and re-sending would double-apply.
      if (!streamedAny && (envelope.emotion_text != null || envelope.caption != null)) {
        deps.turnOutput?.cue({
          ...(envelope.emotion_text != null ? { emotion_text: envelope.emotion_text } : {}),
          ...(envelope.caption != null ? { caption: envelope.caption } : {}),
        });
      }

      // B4 (speech gate): speak only when speech_text has non-whitespace text and is not the [SILENT] token.
      //   Whitespace-only text or a bare [SILENT] = silence — no separate flag/decision, no failure outcome.
      const silentToken = isSilenceToken(envelope.speech_text);
      if (streamedAny) {
        // Streaming path: delta already drove speech, only signal end (don't call speak).
        deps.turnOutput?.end();
        log.debug("speech", { text: envelope.speech_text });
      } else if (envelope.speech_text?.trim() && !silentToken) {
        // Legacy fallback: backend that only provides completed without delta.
        deps.turnOutput?.speak(envelope.speech_text);
        log.debug("speech", { text: envelope.speech_text });
      } else {
        log.info("empty_speech", { trigger: env.event_name });
      }
      const spokeText = streamedAny || (Boolean(envelope.speech_text?.trim()) && !silentToken);
      deps.reportSpokeText?.(spokeText);

      // Conversation state progress (Responses only): persist only at this point after passing all
      // post-stream guards (abort / streamError / !envelope). Only when start-time id unchanged —
      // if reset/rotation (R2) occurred in-flight, don't revive that new state from dead response. CC mode
      // skips snapshot/persist entirely.
      if (!isCC && newResponseId && deps.getPreviousResponseId?.() === startPreviousResponseId) {
        deps.onResponseId?.(newResponseId);
      }

      // Transcript appended here in both modes only (successful turn passing all post-stream guards),
      // and only while the session that started the turn is still running — speech from a turn the
      // user reset away from still plays out, but its turns stay out of the new session's replay.
      // contextHistory below stays ungated on purpose: it is a capped diagnostic log of what was
      // sent, with no session concept and no replay.
      if (deps.transcript) {
        if (deps.transcript.sessionToken() === startSessionToken) {
          if (ctx.user_text !== undefined) {
            deps.transcript.append({ role: "user", text: ctx.user_text, ts: Date.now() });
          }
          if (envelope.speech_text) {
            deps.transcript.append({
              role: "assistant",
              text: envelope.speech_text,
              ts: Date.now(),
            });
          }
        } else {
          log.info("transcript_skipped", { reason: "session_reset", event_name: env.event_name });
        }
      }
      deps.contextHistory?.append({
        ts: Date.now(),
        event_name: env.event_name,
        trigger_kind: clientContext.trigger.kind,
        client_context: clientContext,
      });
      try {
        deps.appendTurnRecord?.(
          buildTurnRecord({
            ts: Date.now(),
            event_name: env.event_name,
            trigger_kind: clientContext.trigger.kind,
            client_context: clientContext,
            spoke_text: spokeText,
          }),
        );
      } catch (err) {
        log.debug("turn_record_append_failed", { error: String(err) });
      }

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
