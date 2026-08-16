/**
 * Backend caller — B1–B5 call sequence.
 *
 * Sends tier2/3 events to backend judgment. Backend side of the firing≠judgment boundary:
 * Speech decision is based solely on whether speech_text is empty (no separate flag: silence = empty speech_text).
 *
 *  B1 package_context — Assemble InputContext (user_text + env.timestamp + env.timezone).
 *  B2 POST — io/chat-client.streamChat(config, req, { fetch, apiKey }). SSE owned by chat-client
 *     — not parsed directly here. In-flight abort via AbortSignal. idle-gap watchdog
 *     (FIRST_EVENT_TIMEOUT_MS until the stream is live, then IDLE_TIMEOUT_MS resetting on each event)
 *     aborts stalled calls — normal turns with long thinking/streaming are not killed.
 *  B3 parse — chat-client's `completed` event already assembled ControlEnvelope.
 *     No completed received → parse_error.
 *  B4 speech gate — speak only when speech_text is not empty. Empty text = silence,
 *     no separate flag. emotion/motion rendered regardless of silence.
 *  B5 dispatch_to_renderer — when per-beat cue streamed, TTS pipeline applies
 *     emotion/motion audio-timed (express→turnOutput.cue), otherwise at completed: renderer.applyDirective(envelope).
 *     speech_text→turnOutput.speak + tool_status→onToolStatus (flowed to TTS/UI in main.ts).
 *
 * Silent drop classification: parse_error(WARN) / network_drop(WARN) / network_stall(WARN, idle timeout).
 */

import type {
  BodyState,
  ControlEnvelope,
  EndpointsConfig,
  FrontmostState,
  InputContext,
  ToolStatus,
  TriggerMeta,
  Usage,
} from "../contract";
import { type ChatRequest, streamChat } from "../io/chat-client";
import { buildCCMessages } from "../io/chat-completions";
import { type ChatHistoryEntry, selectSendSuffix } from "../io/chat-history-store";
import type { ClientToolRegistry } from "../io/client-tools";
import type { ContextHistoryEntry } from "../io/context-history";
import type { Logger } from "../logger";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import { buildContext, imageDataUrlsOf } from "./context-builder";
import type { BusEnvelope } from "./event-bus";
import type { Turn } from "./turn";
import type { TurnOutput } from "./turn-output";

const baseLog = createLogger("backend-caller");

/** "a" / "a and b" / "a, b and c". */
function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Interpolated into the user turn, so a hostile hook payload can't forge structure: the ingress
 * is unauthenticated and caps `summary`/`detail` but not `tool`. Collapsing whitespace keeps the
 * marker one line and the clamp keeps it a name. `trigger.agent.tool` still carries it verbatim.
 */
const TOOL_NAME_MAX = 40;
const toolName = (raw: string): string => raw.replace(/\s+/g, " ").trim().slice(0, TOOL_NAME_MAX);

/**
 * User message for non-user turns (no user_text) — a short, per-trigger notice. Delivered in a
 * role: "user" message, so it is written from the user's POV: "I" is the user, "you" is the
 * agent. Describes what happened, never how to respond (firing ≠ judgment). The only payload
 * interpolation is the coding-agent tool name on `agent.*` turns, which falls back to unnamed
 * wording when validation rejected the payload and the trigger field is absent.
 */
function backgroundMarker(eventName: string, trigger: TriggerMeta): string {
  if (eventName === "proactive.tap_bored") return "(I keep poking at you)";
  if (eventName.startsWith("proactive.touch_")) return "(I just poked you)";
  if (eventName === "proactive.drag_held") return "(I keep dragging you around)";
  if (eventName === "proactive.window_sit") return "(I just sat you down on a window's edge)";
  if (eventName === "proactive.peek") return "(I left you peeking out from the screen edge)";
  if (eventName.startsWith("proactive.")) return "(I've gone quiet for a while)";
  if (eventName.startsWith("schedule.")) return "(it's the time of day you check in on me)";
  if (eventName === "agent.done" || eventName === "agent.needs_input") {
    const tool = trigger.agent ? toolName(trigger.agent.tool) : "";
    const subject = tool ? `my ${tool} task` : "one of my coding tasks";
    return eventName === "agent.done"
      ? `(${subject} just finished)`
      : `(${subject} is waiting on my input)`;
  }
  if (eventName === "agent.catchup") {
    const named = trigger.agent_catchup?.items.map((item) => toolName(item.tool)).filter(Boolean);
    const tools = [...new Set(named ?? [])];
    const subject = tools.length ? `my ${joinNames(tools)} tasks` : "my coding tasks";
    return `(${subject} piled up while I was away)`;
  }
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
 * Idle-gap watchdog deadline (ms) between stream events, once the stream is live. Stall baseline that
 * resets on each event — not a cap on total elapsed time. Does not kill turns with long thinking/streaming,
 * only aborts stalled turns.
 */
export const IDLE_TIMEOUT_MS = 45_000;

/**
 * Watchdog deadline (ms) for the first stream event. The backend may run context compaction and
 * agent-loop work before it emits anything, so the first wait gets its own budget.
 */
export const FIRST_EVENT_TIMEOUT_MS = 240_000;

/**
 * Whether a chat turn has an address to reach. `""` means not configured — a turn settles
 * `not_configured` and the onboarding hint points the user at the settings panel.
 */
export function isChatConfigured(cfg: Pick<EndpointsConfig, "chat_base_url">): boolean {
  return Boolean(cfg.chat_base_url);
}

/** Which watchdog budget expired — carried into the network_stall log. */
type StallStage = "first_event_timeout" | "idle_timeout";

/** Every outcome a backend call can settle to. */
export type TurnOutcome =
  | "ok"
  | "not_configured"
  | "parse_error"
  | "network_drop"
  | "network_stall"
  | "http_4xx_drop"
  | "superseded_by_user";

/** Every outcome except success — what a drop record and the UI error surface deal in. */
export type TurnFailure = Exclude<TurnOutcome, "ok">;

interface BackendCallerDeps {
  /** chat endpoint config. */
  config: EndpointsConfig;
  /** render directive sink (applyDirective). */
  renderer: Pick<Renderer, "applyDirective">;
  /** Hermes auth key resolution (SecretProvider). Unauthenticated placeholder if absent. */
  getApiKey: () => Promise<string | undefined>;
  /** Transport fetch selection (selectFetch). Tauri=cors-fetch, dev=undefined. */
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** Speech lifecycle port — the voice pipeline implements it. */
  turnOutput?: TurnOutput;
  /** When toggle is ON, assembles and returns screenshot block (undefined if OFF/failed). main.ts composes with settings+capturer+buildScreenshotBlock. */
  getScreenshot?: () => Promise<InputContext["screenshot"] | undefined>;
  /** Held posture lookup — called per turn; undefined while the avatar stands free. */
  getBodyState?: () => BodyState | undefined;
  /** Latest frontmost sample lookup — called per turn; undefined until a sample exists. */
  getFrontmost?: () => FrontmostState | undefined;
  /** tool_status sink — called only when present. */
  onToolStatus?: (status: ToolStatus) => void;
  /** B4 speech-gate outcome sink — whether the turn returned speech text, independent of TTS. */
  reportSpokeText?: (spoke: boolean) => void;
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
  /** Integrated conversation transcript — append after completely successful turn in both protocol modes, unless a reset opened a new session meanwhile (sessionToken). CC mode replays the current session from here. */
  transcript?: {
    entriesAfterLastBoundary(): ChatHistoryEntry[];
    append(e: ChatHistoryEntry): void;
    sessionToken(): string;
  };
  /** Local sent-context history, appended only after the turn is confirmed successful. */
  contextHistory?: { append(entry: ContextHistoryEntry): void };
  /** Client-declared tool registry, resolved per turn so vocabulary edits land on the next call. */
  clientTools?: () => ClientToolRegistry;
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

/**
 * Idle-gap watchdog over a stream: yields events as they arrive, but stops (without
 * throwing) and calls `onIdle` with the expired stage if nothing lands in time. The wait
 * for the very first event gets `firstEvent`; every wait after it gets `interEvent`, reset
 * on each event — so it never kills a turn that keeps making progress, only one that stalls.
 */
async function* withIdleWatchdog<T>(
  source: AsyncIterable<T>,
  budgets: { firstEvent: number; interEvent: number },
  onIdle: (stage: StallStage) => void,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  let sawEvent = false;
  while (true) {
    const next = it.next();
    let timer: ReturnType<typeof setTimeout>;
    const idle = new Promise<"idle">((resolve) => {
      timer = setTimeout(() => resolve("idle"), sawEvent ? budgets.interEvent : budgets.firstEvent);
    });
    const race = await Promise.race([next.then((r) => ({ done: r.done, value: r.value })), idle]);
    clearTimeout(timer!);
    if (race === "idle") {
      onIdle(sawEvent ? "idle_timeout" : "first_event_timeout");
      // the abandoned `next` will settle once the aborted stream unwinds — swallow it
      // so it doesn't surface as an unhandled rejection.
      next.catch(() => {});
      return;
    }
    if (race.done) return;
    sawEvent = true;
    yield race.value as T;
  }
}

export function createBackendCaller(deps: BackendCallerDeps): BackendCaller {
  const log = deps.logger ?? baseLog;
  const stream = deps.stream ?? streamChat;

  /**
   * InputContext → OpenAI Responses input — one user item carrying the tagged client_context
   * block followed by userText ?? backgroundMarker(env.event_name, trigger) (+ image content-parts when
   * images present). The `input` array has no contractual system slot: its last item becomes the
   * turn's user message and earlier items land in plain history, so context rides inside the turn.
   * Context leads and the utterance trails it — recall on the trailing query holds as the block grows.
   */
  function encodeInput(
    ctx: InputContext,
    env: BusEnvelope,
    clientContext: Awaited<ReturnType<typeof buildContext>>["clientContext"],
  ): ChatRequest["input"] {
    const text = [
      "<client_context>",
      "Client-injected context; not typed by the user.",
      JSON.stringify(clientContext),
      "</client_context>",
      "",
      ctx.user_text ?? backgroundMarker(env.event_name, clientContext.trigger),
    ].join("\n");
    const images = imageDataUrlsOf(ctx);
    const userContent = images.length
      ? [
          { type: "input_text", text },
          ...images.map((image_url) => ({ type: "input_image", image_url })),
        ]
      : text;

    return [{ role: "user", content: userContent }];
  }

  async function call(turn: Turn, externalSignal?: AbortSignal): Promise<TurnOutcome> {
    const env = turn.trigger;
    if (externalSignal?.aborted) {
      return "superseded_by_user";
    }

    // Clean up remaining audio/speech bubble from the previous (superseded) turn — once before first delta.
    deps.turnOutput?.interrupt();

    // TTFT thinking — when filler is active, start immediately on call() entry (not judgment, first line no delay).
    // End once on actual response speech start (first speech_delta) — usage/express/tool_status before don't
    // break thinking. Silence/error/abort turns guaranteed end by finally.
    // call() may overlap turns, so keep state per-invocation local (never closure/module scope).
    let thinkingStarted = false;
    let thinkingDone = false;
    // Whether running tool_status was passed and not yet closed with done — cleanup decision in finally.
    let toolRunning = false;
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
      if (deps.turnOutput?.hasFiller() && !isReflexTurn(env.event_name)) startThinking();

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
        onScreenshotError: (error) => log.warn("screenshot.failed", { error: String(error) }),
      });
      const input = encodeInput(ctx, env, clientContext);
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
          clientContextJson: JSON.stringify(clientContext),
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
      // Chain-break 404 recovery: retry at most once, so this flips true before the retry attempt.
      let chainBreakRetried = false;
      // Attempt loop: body runs once, `continue`s exactly once on a 404 chain-break, then always exits via break/return.
      while (true) {
        envelope = undefined;
        newResponseId = undefined;
        streamedAny = false;
        cueStreamed = false;
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
            { firstEvent: FIRST_EVENT_TIMEOUT_MS, interEvent: IDLE_TIMEOUT_MS },
            (stage) => {
              stallStage = stage;
              ac.abort();
            },
          )) {
            if (externalSignal?.aborted) break;
            switch (ev.type) {
              case "speech_delta":
                // Actual response speech start — end thinking only here (thinkingDone ensures only first delta).
                // usage/express/tool_status before don't break thinking.
                endThinking();
                deps.turnOutput?.delta(ev.text);
                streamedAny = true;
                break;
              case "express":
                // Pass the entire cue as-is — TTS pipeline applies audio-timed at sentence playback.
                deps.turnOutput?.cue(ev.args);
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
            return "superseded_by_user";
          }
          if (streamedAny) deps.turnOutput?.abort();
          log.warn("network_drop", { stage: "stream_threw", error: String(err) });
          return "network_drop";
        }

        if (stallStage) {
          // Nothing landed inside the budget for this phase — stalled.
          if (streamedAny) deps.turnOutput?.abort();
          log.warn("network_stall", {
            stage: stallStage,
            idle_ms:
              stallStage === "first_event_timeout" ? FIRST_EVENT_TIMEOUT_MS : IDLE_TIMEOUT_MS,
          });
          return "network_stall";
        }

        if (externalSignal?.aborted) {
          return "superseded_by_user";
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
          log.warn("parse_error", { event_name: env.event_name });
          return "parse_error";
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
        deps.turnOutput?.cue({ emotion_text: envelope.emotion_text });
      }

      // B4 (speech gate): speak only when speech_text is not empty.
      //   Empty text = silence — no separate flag/decision, no failure outcome.
      if (streamedAny) {
        // Streaming path: delta already drove speech, only signal end (don't call speak).
        deps.turnOutput?.end();
        log.debug("speech", { text: envelope.speech_text });
      } else if (envelope.speech_text) {
        // Legacy fallback: backend that only provides completed without delta.
        deps.turnOutput?.speak(envelope.speech_text);
        log.debug("speech", { text: envelope.speech_text });
      } else {
        log.info("empty_speech", { trigger: env.event_name });
      }
      deps.reportSpokeText?.(streamedAny || Boolean(envelope.speech_text));

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

      return "ok";
    } finally {
      endThinking();
      // Prevent running chip from surviving without done — on all exit paths including dead turns
      // (abort·drop·stall), flow one idle so consumer brings chip down.
      if (toolRunning) deps.onToolStatus?.({ state: "idle" });
    }
  }

  return { call };
}
