/**
 * Backend caller — B1–B5 call sequence.
 *
 * Sends tier2/3 events to backend judgment. Backend side of the firing≠judgment boundary:
 * Speech decision is based solely on whether speech_text is empty (no separate flag: silence = empty speech_text).
 *
 *  B1 package_context — Assemble InputContext (user_text + env.timestamp +
 *     env.timezone). active_app/window attached best-effort only when getOsContext snapshot available.
 *     recent_apps snapshotted only by peekRecentApps (not cleared) — buffer cleared only by drainRecentApps
 *     once send confirmed (post-stream guard passed), so app history not lost on prior client failure
 *     (setup/stream/parse_error).
 *  B2 POST — io/chat-client.streamChat(config, req, { fetch, apiKey }). SSE owned by chat-client
 *     — not parsed directly here. In-flight abort via AbortSignal. idle-gap watchdog
 *     (IDLE_TIMEOUT_MS, resets on each stream event) aborts stalled calls — TTFT is just the first gap,
 *     normal turns with long thinking/streaming are not killed.
 *  B3 parse — chat-client's `completed` event already assembled ControlEnvelope.
 *     No completed received → parse_error.
 *  B4 speech gate — speak only when speech_text is not empty. Empty text = silence,
 *     no separate flag. emotion/motion rendered regardless of silence.
 *  B5 dispatch_to_renderer — when per-beat cue streamed, TTS pipeline applies
 *     emotion/motion audio-timed (express→onCue), otherwise at completed: renderer.applyDirective(envelope).
 *     speech_text→onSpeech + tool_status→onToolStatus (flowed to TTS/UI in main.ts).
 *
 * Silent drop classification: parse_error(WARN) / network_drop(WARN, includes idle timeout).
 */

import type {
  ControlEnvelope,
  EndpointsConfig,
  ExpressArgs,
  InputContext,
  ToolStatus,
  Usage,
} from "../contract";
import { type ChatRequest, streamChat } from "../io/chat-client";
import { buildCCMessages } from "../io/chat-completions";
import { type ChatHistoryEntry, selectSendSuffix } from "../io/chat-history-store";
import type { ContextHistoryEntry } from "../io/context-history";
import type { Logger } from "../logger";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import {
  ALL_CONTEXT_SIGNALS,
  buildContext,
  type ContextPolicy,
  imageDataUrlsOf,
} from "./context-builder";
import type { BusEnvelope } from "./event-bus";
import type { DropReason } from "./guardrails";

const baseLog = createLogger("backend-caller");
const DEFAULT_CONTEXT_POLICY: ContextPolicy = Object.fromEntries(
  ALL_CONTEXT_SIGNALS.map((signal) => [signal, true]),
) as unknown as ContextPolicy;

/**
 * User message for non-user turns (no user_text) — a short, per-trigger notice. Delivered in a
 * role: "user" message, so it is written from the user's POV: "I" is the user, "you" is the
 * agent. Describes what happened, never how to respond (firing ≠ judgment). No payload
 * interpolation.
 */
function backgroundMarker(eventName: string): string {
  if (eventName === "proactive.tap_bored") return "(I keep poking at you)";
  if (eventName.startsWith("proactive.touch_")) return "(I just poked you)";
  if (eventName === "proactive.drag_held") return "(I keep dragging you around)";
  if (eventName === "proactive.window_sit") return "(I just sat you down on a window's edge)";
  if (eventName === "proactive.peek") return "(I left you peeking out from the screen edge)";
  if (eventName.startsWith("proactive.")) return "(I've gone quiet for a while)";
  if (eventName.startsWith("schedule.")) return "(it's the time of day you check in on me)";
  if (eventName === "agent.done") return "(one of my coding tasks just finished)";
  if (eventName === "agent.catchup") return "(my coding tasks wrapped up while I was away)";
  if (eventName === "signals.push") return "(a new signal just arrived for you)";
  if (eventName === "signals.catchup") return "(signals piled up while I was away)";
  return "(something just caught your attention)";
}

/**
 * Reflex turns are immediate reactions to physical interaction — they skip the TTFT thinking
 * filler, since a deliberative "thinking" bridge before a reflex reaction feels wrong.
 * Client-only render policy; never sent to the backend.
 */
const REFLEX_EVENT_NAMES = new Set([
  "proactive.drag_held",
  "proactive.window_sit",
  "proactive.peek",
]);

function isReflexTurn(eventName: string): boolean {
  return eventName.startsWith("proactive.touch_") || REFLEX_EVENT_NAMES.has(eventName);
}

/**
 * Idle-gap watchdog deadline (ms). Stall baseline that resets on each stream event (including first byte) —
 * not a cap on total elapsed time. Does not kill turns with long thinking/streaming, only aborts stalled turns.
 */
export const IDLE_TIMEOUT_MS = 45_000;

/** Dispatcher → Backend Caller output: { ok, drop_reason? }. */
export interface BackendCallResult {
  ok: boolean;
  drop_reason?: DropReason;
}

interface BackendCallerDeps {
  /** chat endpoint config. */
  config: EndpointsConfig;
  /** render directive sink (applyDirective). */
  renderer: Pick<Renderer, "applyDirective">;
  /** Hermes auth key resolution (SecretProvider). Unauthenticated placeholder if absent. */
  getApiKey: () => Promise<string | undefined>;
  /** Transport fetch selection (selectFetch). Tauri=cors-fetch, dev=undefined. */
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** Speech text sink — main.ts connects to speech bubble + TTS pipeline. Fallback for delta-less backend. */
  onSpeech?: (text: string) => void;
  /** Speech token increment sink — called per speech_delta (streaming TTS). main.ts connects to speech bubble accumulation + pipeline driving. */
  onSpeechDelta?: (text: string) => void;
  /** Speech stream end sink — once after all deltas. main.ts connects to speech bubble dwell retention + pipeline flush. */
  onSpeechEnd?: () => void;
  /** Speech interrupt sink — once on call() entry. Cleans up remaining audio/speech bubble from the previous (superseded) turn. */
  onSpeechInterrupt?: () => void;
  /** Speech abnormal end sink — when stream ended due to error/disconnect (not user supersede) and at least one delta arrived. Cleans up speech bubble/audio. */
  onSpeechAbort?: () => void;
  /** When toggle is ON, assembles and returns screenshot block (undefined if OFF/failed). main.ts composes with settings+capturer+buildScreenshotBlock. */
  getScreenshot?: () => Promise<InputContext["screenshot"] | undefined>;
  /** Current foreground app/title snapshot. When present, fills env.active_app/active_window_title. */
  getOsContext?: () => import("../io/os-context").OsContextSnapshot | undefined;
  /** Current physical posture. Undefined means idle. */
  getPosture?: () => import("../contract").Posture | undefined;
  /** Per-turn signal inclusion policy. Defaults to all signals enabled. */
  getContextPolicy?: () => ContextPolicy;
  /** Snapshot app buffer without clearing, called at B1 packaging, attached to env.recent_apps when present.
   * Buffer not cleared, so app history not lost even if packageContext fails afterward (setup/stream/parse_error). */
  peekRecentApps?: () => import("../io/os-context").RecentApp[];
  /** Only at send confirmation (success — completed received + post-stream guard passed), remove only the
   * snapshot peekedApps from buffer. Not called from packageContext — if client failure occurs between them,
   * buffer not cleared, carries to next turn, and any app switch after peek also escapes removal. */
  drainRecentApps?: (
    only?: import("../io/os-context").RecentApp[],
  ) => import("../io/os-context").RecentApp[];
  /** Per-beat cue sink — passes each express cue as-is (emotion_id/motion_id/emotion_text). main.ts wires to TTS pipeline (speechPlayback.setCue) — applied audio-timed at sentence playback. */
  onCue?: (cue: ExpressArgs) => void;
  /** tool_status sink — called only when present. */
  onToolStatus?: (status: ToolStatus) => void;
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
  getAgentSettings?: () => import("../io/agent-settings").AgentSettings;
  /** TTFT thinking entry sink — when filler is active, once synchronously on call() entry. token is unique to this call(). main.ts connects to thinking motion + filler speech loop. */
  onThinkingStart?: (token: object) => void;
  /** TTFT thinking end sink — once on first speech_delta (actual response speech start) / turn end (any path). Same token as start. main.ts masks cross-turn supersede by token. */
  onThinkingEnd?: (token: object) => void;
  /** Filler active status query — returns true if filler is on + pool non-empty. Thinking starts synchronously only when true (called per turn). */
  getFiller?: () => boolean;
  /** Integrated conversation transcript — append after completely successful turn in both protocol modes. CC mode also extracts send here. */
  transcript?: { get(): ChatHistoryEntry[]; append(e: ChatHistoryEntry): void };
  /** Local sent-context history, appended only after the turn is confirmed successful. */
  contextHistory?: { append(entry: ContextHistoryEntry): void };
  /** Structured logging (defaults to backend_caller namespace logger if absent). */
  logger?: Logger;
}

export interface BackendCaller {
  /**
   * Execute B1–B5 for one trigger envelope. In-flight aborted if externalSignal aborts.
   * Never throws — failures expressed as { ok:false, drop_reason } (dispatcher branches).
   */
  call(env: BusEnvelope, externalSignal?: AbortSignal): Promise<BackendCallResult>;
}

/**
 * Idle-gap watchdog over a stream: yields events as they arrive, but stops (without
 * throwing) and calls `onIdle` if no event — including the very first — lands within
 * `ms` of the previous one. The deadline resets on every event, so it never kills a
 * turn that keeps making progress, only one that stalls.
 */
async function* withIdleWatchdog<T>(
  source: AsyncIterable<T>,
  ms: number,
  onIdle: () => void,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  while (true) {
    const next = it.next();
    let timer: ReturnType<typeof setTimeout>;
    const idle = new Promise<"idle">((resolve) => {
      timer = setTimeout(() => resolve("idle"), ms);
    });
    const race = await Promise.race([next.then((r) => ({ done: r.done, value: r.value })), idle]);
    clearTimeout(timer!);
    if (race === "idle") {
      onIdle();
      // the abandoned `next` will settle once the aborted stream unwinds — swallow it
      // so it doesn't surface as an unhandled rejection.
      next.catch(() => {});
      return;
    }
    if (race.done) return;
    yield race.value as T;
  }
}

export function createBackendCaller(deps: BackendCallerDeps): BackendCaller {
  const log = deps.logger ?? baseLog;

  /**
   * InputContext → OpenAI Responses input (user speech encoded only in user message).
   * User message: userText ?? backgroundMarker(env.event_name) (+ image content-part when images present).
   */
  function encodeInput(
    ctx: InputContext,
    env: BusEnvelope,
    clientContext: Awaited<ReturnType<typeof buildContext>>["clientContext"],
  ): ChatRequest["input"] {
    const text = ctx.user_text ?? backgroundMarker(env.event_name);
    const images = imageDataUrlsOf(ctx);
    const userContent = images.length
      ? [
          { type: "input_text", text },
          ...images.map((image_url) => ({ type: "input_image", image_url })),
        ]
      : text;

    return [
      {
        role: "system",
        content: `client_context: ${JSON.stringify(clientContext)}`,
      },
      { role: "user", content: userContent },
    ];
  }

  async function call(env: BusEnvelope, externalSignal?: AbortSignal): Promise<BackendCallResult> {
    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    // Clean up remaining audio/speech bubble from the previous (superseded) turn — once before first delta.
    deps.onSpeechInterrupt?.();

    // TTFT thinking — when filler is active, start immediately on call() entry (not judgment, first line no delay).
    // End once on actual response speech start (first speech_delta) — usage/express/tool_status before don't
    // break thinking. Silence/error/abort turns guaranteed end by finally.
    // call() may overlap turns, so keep state per-invocation local (never closure/module scope).
    // turnToken: unique identity for this call() — same token in start/end so main.ts masks stale end
    // in cross-turn supersede (overlapping next turn overtakes this turn) by token.
    const turnToken = {};
    let thinkingStarted = false;
    let thinkingDone = false;
    // Whether running tool_status was passed and not yet closed with done — cleanup decision in finally.
    let toolRunning = false;
    const startThinking = () => {
      if (thinkingStarted || thinkingDone) return;
      thinkingStarted = true;
      deps.onThinkingStart?.(turnToken);
    };
    const endThinking = () => {
      if (thinkingDone) return;
      thinkingDone = true;
      if (thinkingStarted) deps.onThinkingEnd?.(turnToken);
    };

    // Wrap entire span in try/finally — thinking end guaranteed exactly once on any exit path
    // (setup reject, early abort, stream throw, post-loop abort, streamError, empty/parse_error,
    // normal completion all covered).
    try {
      // If filler is active, show first line immediately (synchronous start). Don't start if disabled/pool empty,
      // or on a reflex turn — a "thinking" bridge before an immediate reaction reads as dissonant.
      if (deps.getFiller?.() && !isReflexTurn(env.event_name)) startThinking();

      // B1
      const policy = deps.getContextPolicy?.() ?? DEFAULT_CONTEXT_POLICY;
      const { ctx, clientContext, record, peekedApps } = await buildContext(
        env,
        {
          getScreenshot: deps.getScreenshot,
          getOsContext: deps.getOsContext,
          getPosture: deps.getPosture,
          peekRecentApps: deps.peekRecentApps,
          onScreenshotError: (error) => log.warn("screenshot.failed", { error: String(error) }),
        },
        policy,
      );
      const input = encodeInput(ctx, env, clientContext);
      log.debug("backend_call", { event_name: env.event_name, seq_id: env.seq_id });

      // B2: After resolving fetch/apiKey, streamChat. Pass externalSignal as-is (delegate abort).
      let apiKey: string | undefined;
      let fetchImpl: typeof globalThis.fetch | undefined;
      try {
        [apiKey, fetchImpl] = await Promise.all([deps.getApiKey(), deps.getFetch()]);
      } catch (err) {
        log.warn("network_drop", { stage: "setup", error: String(err) });
        return { ok: false, drop_reason: "network_drop" };
      }

      if (externalSignal?.aborted) {
        return { ok: false, drop_reason: "superseded_by_user" };
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
          deps.transcript?.get() ?? [],
          deps.config.chat_model_context_window,
        );
        const imageDataUrls = imageDataUrlsOf(ctx);
        request.messages = buildCCMessages({
          ...(effectiveInstructions ? { instructions: effectiveInstructions } : {}),
          clientContextJson: JSON.stringify(clientContext),
          transcript: ccTranscript,
          userText: ctx.user_text ?? backgroundMarker(env.event_name),
          ...(imageDataUrls.length ? { imageDataUrls } : {}),
        });
      } else {
        startPreviousResponseId = deps.getPreviousResponseId?.();
        if (startPreviousResponseId) request.previous_response_id = startPreviousResponseId;
        // Empty instructions omitted for config fallback.
        if (agent?.instructions.trim()) request.instructions = agent.instructions;
      }

      // B3: Receive ControlEnvelope from chat-client's completed event (no SSE re-parsing).
      let envelope: ControlEnvelope | undefined;
      let newResponseId: string | undefined;
      // Streaming speech: did at least one delta arrive (completion drives onSpeechEnd branching).
      let streamedAny = false;
      // Did at least one express cue arrive during stream (completion drives pipeline ownership branching).
      let cueStreamed = false;
      // Chain-break 404 recovery: retry at most once, so this flips true before the retry attempt.
      let chainBreakRetried = false;
      // Attempt loop: body runs once, `continue`s exactly once on a 404 chain-break, then always exits via break/return.
      while (true) {
        streamedAny = false;
        cueStreamed = false;
        let streamError: string | undefined;
        // HTTP status carried by stream error event (openai SDK APIError.status) — distinguish
        // 401/403 as http_4xx_drop (auth-ish) instead of network_drop.
        let streamErrorStatus: number | undefined;
        // Did idle-gap watchdog detect stall and abort (includes first byte wait).
        let idleTimedOut = false;
        try {
          for await (const ev of withIdleWatchdog(
            streamChat(deps.config, request, { apiKey, fetch: fetchImpl }),
            IDLE_TIMEOUT_MS,
            () => {
              idleTimedOut = true;
              ac.abort();
            },
          )) {
            if (externalSignal?.aborted) break;
            switch (ev.type) {
              case "speech_delta":
                // Actual response speech start — end thinking only here (thinkingDone ensures only first delta).
                // usage/express/tool_status before don't break thinking.
                endThinking();
                deps.onSpeechDelta?.(ev.text);
                streamedAny = true;
                break;
              case "express":
                // Pass the entire cue as-is — TTS pipeline applies audio-timed at sentence playback.
                deps.onCue?.(ev.args);
                cueStreamed = true;
                break;
              case "usage":
                // Diagnostic channel independent of ControlEnvelope/renderer — passes to sink only.
                deps.onUsage?.(ev.usage);
                break;
              case "tool_status":
                // Native tool observation result — pass immediately on streaming to show running chip.
                // Do not call endThinking (:551): tool_status does not break thinking.
                deps.onToolStatus?.(ev.status);
                toolRunning = ev.status.state === "running";
                break;
              case "completed":
                envelope = ev.envelope;
                newResponseId = ev.responseId || undefined;
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
            return { ok: false, drop_reason: "superseded_by_user" };
          }
          if (streamedAny) deps.onSpeechAbort?.();
          log.warn("network_drop", { stage: "stream_threw", error: String(err) });
          return { ok: false, drop_reason: "network_drop" };
        }

        if (idleTimedOut) {
          // No event (incl. first byte) within IDLE_TIMEOUT_MS of the previous one — stalled.
          if (streamedAny) deps.onSpeechAbort?.();
          log.warn("network_drop", { stage: "idle_timeout", idle_ms: IDLE_TIMEOUT_MS });
          return { ok: false, drop_reason: "network_drop" };
        }

        if (externalSignal?.aborted) {
          return { ok: false, drop_reason: "superseded_by_user" };
        }

        if (streamError) {
          // If delta arrived, clean up speech bubble/audio — prevent getting stuck forever without next turn.
          if (streamedAny) deps.onSpeechAbort?.();
          // Distinguish auth-ish (401/403) status as http_4xx_drop — keep other 4xx/5xx/no-status as network_drop.
          if (streamErrorStatus === 401 || streamErrorStatus === 403) {
            log.warn("http_4xx_drop", {
              stage: "stream_error",
              status: streamErrorStatus,
              message: streamError,
            });
            return { ok: false, drop_reason: "http_4xx_drop" };
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
          return { ok: false, drop_reason: "network_drop" };
        }

        if (!envelope) {
          // No completed received = broken/empty response.
          log.warn("parse_error", { event_name: env.event_name });
          return { ok: false, drop_reason: "parse_error" };
        }

        break;
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

      // Completed path only: no per-beat cue carried emotion_text, so route it through the
      // same cue channel here — emotion_id/motion_id omitted, applyDirective above already
      // rendered them and re-sending would double-apply.
      if (!streamedAny && envelope.emotion_text != null) {
        deps.onCue?.({ emotion_text: envelope.emotion_text });
      }

      // B4 (speech gate): speak only when speech_text is not empty.
      //   Empty text = silence — no separate flag/decision, no drop_reason.
      if (streamedAny) {
        // Streaming path: delta already drove speech, only signal end (don't call onSpeech).
        deps.onSpeechEnd?.();
        log.debug("speech", { text: envelope.speech_text });
      } else if (envelope.speech_text) {
        // Legacy fallback: backend that only provides completed without delta.
        deps.onSpeech?.(envelope.speech_text);
        log.debug("speech", { text: envelope.speech_text });
      } else {
        log.info("empty_speech", { trigger: env.event_name });
      }

      // Conversation state progress (Responses only): persist only at this point after passing all
      // post-stream guards (abort / streamError / !envelope). Only when start-time id unchanged —
      // if reset/rotation (R2) occurred in-flight, don't revive that new state from dead response. CC mode
      // skips snapshot/persist entirely.
      if (!isCC && newResponseId && deps.getPreviousResponseId?.() === startPreviousResponseId) {
        deps.onResponseId?.(newResponseId);
      }

      // Transcript appended here in both modes only (successful turn passing all post-stream guards).
      if (ctx.user_text !== undefined) {
        deps.transcript?.append({ role: "user", text: ctx.user_text, ts: Date.now() });
      }
      if (envelope.speech_text) {
        deps.transcript?.append({ role: "assistant", text: envelope.speech_text, ts: Date.now() });
      }
      deps.contextHistory?.append({
        ts: Date.now(),
        event_name: env.event_name,
        trigger_kind: clientContext.trigger.kind,
        included: record.included,
        excluded: record.excluded,
        client_context: clientContext,
      });

      // Recent-apps buffer: clear only now that the turn is a confirmed success — same
      // post-stream guard boundary as transcript/onResponseId above. Any earlier client-side
      // failure (setup reject, stream throw/error, parse_error) returns before reaching here,
      // so the buffer survives and carries over to the next turn instead of being lost.
      // Drain only the peeked snapshot — an app switch that landed mid-request (after peek) was
      // never sent this turn, so it stays buffered for the next one instead of being discarded.
      if (policy.recent_apps) deps.drainRecentApps?.(peekedApps);

      return { ok: true };
    } finally {
      endThinking();
      // Prevent running chip from surviving without done — on all exit paths including dead turns
      // (abort·drop·stall), flow one idle so consumer brings chip down.
      if (toolRunning) deps.onToolStatus?.({ state: "idle" });
    }
  }

  return { call };
}
