/** One stream attempt of a turn: consumes the backend stream, feeds the speech pipeline, and judges how it ended. */
import type { ControlEnvelope, EndpointsConfig, Usage } from "../../contract";
import type {
  ChatRequest,
  StreamChatOptions,
  streamChat,
  ToolOutputItem,
} from "../../io/chat/stream/chat-client";
import { createSilenceTokenFilter } from "../../io/chat/stream/silence-token";
import type { Logger } from "../../logger";
import type { Turn } from "../turn/turn";
import type { TurnFeed } from "../turn/turn-feed";
import {
  PRE_SPEECH_TIMEOUT_MS,
  SPEECH_IDLE_TIMEOUT_MS,
  type StallStage,
  withIdleWatchdog,
} from "./idle-watchdog";
import type { PushCallDeps } from "./push-call";
import type { TurnFailure } from "./turn-outcome";

/** The subset of `createBackendCaller`'s deps that one stream attempt reads. */
export interface StreamAttemptDeps extends Pick<PushCallDeps, "turnOutput"> {
  /** chat endpoint config. */
  config: EndpointsConfig;
  /** The shared tool-status/reasoning consumer — the streaming path feeds it under this turn's owner. */
  turnFeed?: TurnFeed;
  /** usage (token occupancy) sink — called only when present. Diagnostic channel independent of ControlEnvelope. */
  onUsage?: (usage: Usage) => void;
}

export interface AttemptArgs {
  turn: Turn;
  /** Everything this attempt feeds the shared turn feed carries this owner. */
  owner: string;
  externalSignal?: AbortSignal;
  /** Aborts the request's controller; the controller itself stays with the caller. */
  abort: () => void;
  request: ChatRequest;
  streamOpts: StreamChatOptions;
  /** Ends the TTFT thinking filler; its flags stay with the caller. */
  endThinking: () => void;
}

export type AttemptResult =
  | {
      kind: "reply";
      envelope: ControlEnvelope;
      newResponseId: string | undefined;
      /** Outputs of the final response's unanswered calls; persisted with its id. */
      toolOutputs: ToolOutputItem[] | undefined;
      /** Post-flush value. */
      streamedAny: boolean;
      cueStreamed: boolean;
    }
  /** Ends on superseded_by_user, network_stall, http_4xx_drop, network_drop or parse_error. */
  | { kind: "drop"; outcome: TurnFailure }
  | {
      kind: "stream_error";
      message: string;
      status: number | undefined;
      streamedAny: boolean;
    };

export interface StreamAttempt {
  /** Runs one attempt. Per-attempt state is local, so a retry starts clean. */
  run(args: AttemptArgs): Promise<AttemptResult>;
}

export function createStreamAttempt(
  deps: StreamAttemptDeps,
  log: Logger,
  stream: typeof streamChat,
): StreamAttempt {
  async function run(args: AttemptArgs): Promise<AttemptResult> {
    const { turn, owner, externalSignal, abort, request, streamOpts, endThinking } = args;
    // B3: Receive ControlEnvelope from chat-client's completed event (no SSE re-parsing).
    let envelope: ControlEnvelope | undefined;
    let newResponseId: string | undefined;
    let toolOutputs: ToolOutputItem[] | undefined;
    // Streaming speech: did at least one delta arrive (completion drives turnOutput.end branching).
    let streamedAny = false;
    // Did at least one express cue arrive during stream (completion drives pipeline ownership branching).
    let cueStreamed = false;
    // Holds back the stream head until a bare [SILENT] token can be ruled out — re-created per attempt.
    const silenceFilter = createSilenceTokenFilter();
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
        stream(deps.config, request, streamOpts),
        { preSpeech: PRE_SPEECH_TIMEOUT_MS, speechIdle: SPEECH_IDLE_TIMEOUT_MS },
        (stage) => {
          stallStage = stage;
          abort();
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
            toolOutputs = ev.toolOutputs;
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
        return { kind: "drop", outcome: "superseded_by_user" };
      }
      if (streamedAny) deps.turnOutput?.abort();
      log.warn("network_drop", { stage: "stream_threw", error: String(err) });
      return { kind: "drop", outcome: "network_drop" };
    }

    // Ahead of the stall branch: a superseded turn whose stream hangs rather than rejecting
    // would otherwise tear down the pipeline the next turn already owns.
    if (externalSignal?.aborted) {
      return { kind: "drop", outcome: "superseded_by_user" };
    }

    if (stallStage) {
      // Nothing landed inside the budget for this phase — stalled.
      if (streamedAny) deps.turnOutput?.abort();
      log.warn("network_stall", {
        stage: stallStage,
        idle_ms:
          stallStage === "pre_speech_timeout" ? PRE_SPEECH_TIMEOUT_MS : SPEECH_IDLE_TIMEOUT_MS,
      });
      return { kind: "drop", outcome: "network_stall" };
    }

    if (streamError !== undefined) {
      // If delta arrived, clean up speech bubble/audio — prevent getting stuck forever without next turn.
      if (streamedAny) deps.turnOutput?.abort();
      // Distinguish auth-ish (401/403) status as http_4xx_drop — keep other 4xx/5xx/no-status as network_drop.
      if (streamErrorStatus === 401 || streamErrorStatus === 403) {
        log.warn("http_4xx_drop", {
          stage: "stream_error",
          status: streamErrorStatus,
          message: streamError,
        });
        return { kind: "drop", outcome: "http_4xx_drop" };
      }
      return {
        kind: "stream_error",
        message: streamError,
        status: streamErrorStatus,
        streamedAny,
      };
    }

    if (!envelope) {
      // No completed received = broken/empty response.
      // If delta arrived, clean up speech bubble/audio — a half-spoken turn would otherwise stay open.
      if (streamedAny) deps.turnOutput?.abort();
      log.warn("parse_error", { event_name: turn.trigger.event_name });
      return { kind: "drop", outcome: "parse_error" };
    }

    // A head the stream ended on before it could diverge is either a bare [SILENT]
    // (dropped) or a partial prefix cut short (spoken as-is).
    const rest = silenceFilter.flush();
    if (rest) {
      deps.turnOutput?.delta(rest);
      streamedAny = true;
    }

    return { kind: "reply", envelope, newResponseId, toolOutputs, streamedAny, cueStreamed };
  }

  return { run };
}
