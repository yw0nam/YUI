/**
 * Responses API stream — `client.responses.create({ stream: true })` mapped onto ChatStreamEvent.
 *
 * express tool naming: the tool is matched by SUFFIX (`name.endsWith("generate_express")`),
 *   so it recognizes both the plain `generate_express` and the MCP-namespaced
 *   `mcp_<server>_generate_express` form some backends emit. Sibling MCP tools
 *   (e.g. `..._get_ids`) do NOT match → they stay generic tool_status chips.
 *
 * express args shape: the spec streams args via response.function_call_arguments.done,
 *   but some backends instead ship the complete `arguments` JSON inside the
 *   function_call item of response.output_item.added/done. Both paths are parsed;
 *   whichever arrives first for a given call wins. A backend may emit one generate_express
 *   per expressive beat — every distinct call emits its own express event, deduped
 *   per call (by function-call item id, falling back to output_index).
 *
 * Event → ChatStreamEvent mapping:
 *  - response.output_text.delta → speech_delta (accumulated into speech_text).
 *  - response.output_text.done  → speech_done.
 *  - response.reasoning_summary_text.delta / response.reasoning_text.delta → reasoning
 *    (the chip's text as it streams; never spoken, never stored).
 *  - response.reasoning_summary_part.added → the "\n\n" break between summary parts
 *    (the first part adds nothing).
 *  - response.output_item.added (function_call):
 *      · isExpressTool(name) → if item.arguments present and call not yet emitted,
 *        JSON.parse → express.
 *      · else → tool_status running.
 *  - response.function_call_arguments.done:
 *      · isExpressTool(name) → if call not yet emitted, JSON.parse(arguments) → ExpressArgs
 *        (FLAT: emotion_id?/motion_id?/emotion_text?). parse failure → error event
 *        (does NOT throw / abort the loop, does NOT mark the call emitted).
 *      · native tool → no event here (completion handled at output_item.done).
 *  - response.output_item.done (function_call):
 *      · isExpressTool(name) → if call not yet emitted and item.arguments present,
 *        JSON.parse → express (covers backends with no function_call_arguments.* events).
 *      · else → tool_status done.
 *  - response.completed → completed event with the assembled ControlEnvelope. Normalization
 *    happens HERE: emotion_id→emotion{id}, motion_id→motion{id},
 *    emotion_text→emotion_text. Silence is an empty speech_text; no client-side speak gate.
 *  - error → error event.
 *  - response.failed / response.incomplete → error event (terminal, not liveness).
 *  - any other event → keepalive (wire liveness only; resets the caller's idle watchdog).
 *
 * ⚠ function_call items are ABSENT from response.completed's final output[] →
 *   generate_express/tool state must be captured mid-stream and remembered until completed.
 *
 * Event shapes: openai@6.42 d.ts.
 */

import type OpenAI from "openai";
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";

import type { ControlEnvelope, EndpointsConfig, ExpressArgs, ToolStatus } from "../../../contract";
import type { ChatRequest, ChatStreamEvent } from "./chat-client";
import {
  httpStatusOf,
  isExpressTool,
  normalizeExpressIntoEnvelope,
  serverMessageOf,
} from "./stream-helpers";

/**
 * Per-call dedup key — one generate_express call shares the same function-call item id across
 * added/done/arguments.done. Falls back to output_index if id is absent.
 */
function expressCallKey(id: unknown, outputIndex: unknown): string {
  return typeof id === "string" && id.length > 0 ? id : String(outputIndex);
}

/** Parses express arguments JSON string. On failure, returns error message without throwing. */
function parseExpressArgs(raw: unknown): { args: ExpressArgs } | { error: string } {
  try {
    return { args: JSON.parse(raw as string) as ExpressArgs };
  } catch (err) {
    return {
      error: `generate_express arguments JSON parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * Calls Responses API stream. Official `openai` SDK adapter.
 *
 * SDK owns transport/abort so we don't handle fetch/SSE directly. Pass request.signal to create()
 * to delegate in-flight abort to SDK, and guard once before loop entry.
 */
export async function* streamResponses(
  client: OpenAI,
  config: EndpointsConfig,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  if (request.signal?.aborted) return;

  // Accumulated state to assemble in completed.
  let speech_text = "";
  // express is emitted per cue (beat). Completed envelope carries last cue as fallback.
  let express: ExpressArgs | undefined;
  let tool_status: ToolStatus | undefined;
  // Same call (id, or output_index if absent) appears multiple times across added/done/arguments.done
  // but emits once. Different calls each emit (per-beat cue).
  const emittedExpressKeys = new Set<string>();
  // A response carries at most one reasoning summary at a time; a later part is a new paragraph.
  let sawSummaryPart = false;

  // instructions: request override (if non-empty takes priority) → falls back to config.chat_instructions.
  const effectiveInstructions = request.instructions?.trim()
    ? request.instructions
    : config.chat_instructions;

  let stream: AsyncIterable<ResponseStreamEvent>;
  try {
    const params: ResponseCreateParamsStreaming = {
      // model: config-driven (EndpointsConfig.chat_model). The Responses API requires model —
      // omit if unset (for test mocks and model-less backends). Prod endpoints.json must set.
      ...(config.chat_model ? { model: config.chat_model } : {}),
      // instructions: request override takes priority, fallback to config nudge. Omit if both absent.
      ...(effectiveInstructions ? { instructions: effectiveInstructions } : {}),
      // reasoning.effort: only pass if present in request (none/minimal/low/medium all explicit).
      ...(request.reasoning_effort ? { reasoning: { effort: request.reasoning_effort } } : {}),
      // ChatRequest.input is deliberately unknown (OpenAI-compatible input, caller encodes) — narrow-cast
      // to the shape SDK expects only at the call site.
      input: request.input as ResponseCreateParamsStreaming["input"],
      previous_response_id: request.previous_response_id,
      stream: true,
    };
    stream = await client.responses.create(params, { signal: request.signal });
  } catch (err) {
    // Abort silently if aborted signal (prevent hang). Otherwise (401 auth failure / network etc) expose
    // as error event without silencing — prevent trap where placeholder key 401 disappears as "empty stream".
    // status: pass through HTTP status (401/403 etc) from openai SDK APIError as-is — only if present.
    if (!request.signal?.aborted) {
      const status = httpStatusOf(err);
      yield {
        type: "error",
        message: serverMessageOf(err),
        ...(status !== undefined ? { status } : {}),
      };
    }
    return;
  }

  try {
    for await (const event of stream) {
      if (request.signal?.aborted) return;

      switch (event.type) {
        case "response.output_text.delta": {
          speech_text += event.delta;
          yield { type: "speech_delta", text: event.delta };
          break;
        }

        case "response.output_text.done": {
          yield { type: "speech_done", text: event.text };
          break;
        }

        case "response.output_item.added": {
          const item = event.item;
          if (item?.type === "function_call") {
            if (isExpressTool(item.name)) {
              // Live backend embeds complete arguments directly in added/done item.
              const key = expressCallKey(item.id, event.output_index);
              if (!emittedExpressKeys.has(key) && item.arguments) {
                const result = parseExpressArgs(item.arguments);
                if ("args" in result) {
                  express = result.args;
                  emittedExpressKeys.add(key);
                  yield { type: "express", args: result.args };
                } else {
                  yield { type: "error", message: result.error };
                }
              }
            } else {
              tool_status = { state: "running", tool_id: item.name };
              yield { type: "tool_status", status: tool_status };
            }
          }
          break;
        }

        case "response.function_call_arguments.done": {
          if (isExpressTool(event.name)) {
            const key = expressCallKey(event.item_id, event.output_index);
            if (!emittedExpressKeys.has(key)) {
              const result = parseExpressArgs(event.arguments);
              if ("args" in result) {
                express = result.args;
                emittedExpressKeys.add(key);
                yield { type: "express", args: result.args };
              } else {
                yield { type: "error", message: result.error };
                // CONTINUE — never throw, never abort the loop.
              }
            }
          }
          // native tool: completion handled at output_item.done.
          break;
        }

        case "response.output_item.done": {
          const item = event.item;
          if (item?.type === "function_call") {
            if (isExpressTool(item.name)) {
              // Backends without function_call_arguments.* events have args only in done item.
              const key = expressCallKey(item.id, event.output_index);
              if (!emittedExpressKeys.has(key) && item.arguments) {
                const result = parseExpressArgs(item.arguments);
                if ("args" in result) {
                  express = result.args;
                  emittedExpressKeys.add(key);
                  yield { type: "express", args: result.args };
                } else {
                  yield { type: "error", message: result.error };
                }
              }
            } else {
              tool_status = { state: "done", tool_id: item.name };
              yield { type: "tool_status", status: tool_status };
            }
          }
          break;
        }

        case "response.completed": {
          // Token usage flows as its own event only (not in ControlEnvelope). Omit emit if usage block
          // completely absent; zero-fill any missing fields.
          const rawUsage = event.response?.usage;
          if (rawUsage) {
            yield {
              type: "usage",
              usage: {
                input_tokens: rawUsage.input_tokens ?? 0,
                output_tokens: rawUsage.output_tokens ?? 0,
                total_tokens: rawUsage.total_tokens ?? 0,
              },
            };
          }
          // Normalization (chat-client ONLY): FLAT args → renderer seam shape.
          const envelope: ControlEnvelope = { speech_text };
          normalizeExpressIntoEnvelope(envelope, express);
          yield { type: "completed", envelope, responseId: event.response?.id ?? "" };
          break;
        }

        case "error": {
          yield { type: "error", message: event.message };
          break;
        }

        case "response.failed":
        case "response.incomplete": {
          // Terminal without completed — an error, not liveness: a dead turn must not
          // reset the caller's idle deadline.
          yield { type: "error", message: event.response?.error?.message ?? event.type };
          break;
        }

        case "response.reasoning_summary_text.delta":
        case "response.reasoning_text.delta": {
          if (event.delta) yield { type: "reasoning", delta: event.delta };
          break;
        }

        case "response.reasoning_summary_part.added": {
          if (sawSummaryPart) yield { type: "reasoning", delta: "\n\n" };
          sawSummaryPart = true;
          break;
        }

        default:
          // Unhandled events (backend heartbeats during long work such as
          // context compaction) carry no payload we consume but prove the wire is alive.
          yield { type: "keepalive" };
          break;
      }
    }
  } catch (err) {
    // Abort mid-stream → terminate silently regardless of any status the error carries.
    if (request.signal?.aborted) return;
    // APIError-shaped throw (has a numeric HTTP status, e.g. a 404 chain-break on
    // previous_response_id) → surface so the caller can react (chain-break retry etc).
    const status = httpStatusOf(err);
    if (status !== undefined) {
      yield { type: "error", message: serverMessageOf(err), status };
      return;
    }
    // Status-less network reject mid-stream → terminate silently.
    // Intentional asymmetry: create() catch exposes non-abort errors, but mid-stream
    //   drop here stays silent because partial output already reached consumer and frequency is low.
    return;
  }
}
