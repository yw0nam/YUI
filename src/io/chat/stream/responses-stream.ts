/**
 * Responses API stream — `client.responses.create({ stream: true })` mapped onto ChatStreamEvent.
 *
 * Client-declared tools: the registry (`tools`) is declared on every request of the turn in the
 *   flat Responses function shape. A function_call naming a registered tool is executed once, when
 *   its complete arguments are first known (added / arguments.done / output_item.done, whichever
 *   comes first); a call naming an unregistered tool runs on the backend — observed, never answered.
 *   The round trip happens when a tool that answers a question ran, or when only cue-only (oneWay)
 *   tools ran and the response said nothing; a response that already spoke is a finished turn.
 *   Bounded by MAX_TOOL_ROUND_TRIPS. The follow-up request keeps the turn's original
 *   previous_response_id and re-sends the input items plus each call and its output, so it never
 *   depends on the server having kept the tool-calling response.
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
 *      · isExpressTool(name) or registered → if item.arguments present and call not yet handled,
 *        JSON.parse → express cue (express) and execute (registered).
 *      · else → tool_status running.
 *  - response.function_call_arguments.done:
 *      · isExpressTool(name) or registered → if call not yet handled, JSON.parse(arguments) as
 *        above (FLAT: emotion_id?/motion_id?/emotion_text?). parse failure → error event
 *        (does NOT throw / abort the loop, does NOT mark the call handled).
 *      · native tool → no event here (completion handled at output_item.done).
 *  - response.output_item.done (function_call):
 *      · isExpressTool(name) or registered → if call not yet handled and item.arguments present,
 *        parse and act as above (covers backends with no function_call_arguments.* events).
 *      · else → tool_status done.
 *  - response.completed → usage, then either the round trip (the stream is left and the follow-up
 *    sent) or the completed event with the assembled ControlEnvelope, at once. Calls that got no
 *    round trip ride on it as toolOutputs. Normalization happens HERE: emotion_id→emotion{id},
 *    motion_id→motion{id}, emotion_text→emotion_text. Silence is an empty speech_text; no
 *    client-side speak gate. An error event only blocks the round trip.
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
  FunctionTool,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";

import type { ControlEnvelope, EndpointsConfig, ExpressArgs } from "../../../contract";
import type { ChatRequest, ChatStreamEvent, ToolOutputItem } from "./chat-client";
import { ownsCall, runClientCall, shouldAnswer } from "./client-tool-run";
import type { ClientToolRegistry } from "./client-tools";
import {
  httpStatusOf,
  MAX_TOOL_ROUND_TRIPS,
  normalizeExpressIntoEnvelope,
  serverMessageOf,
} from "./stream-helpers";

/**
 * Per-call dedup key — one function call shares the same function-call item id across
 * added/done/arguments.done. Falls back to output_index if id is absent.
 */
function callKey(id: unknown, outputIndex: unknown): string {
  return typeof id === "string" && id.length > 0 ? id : String(outputIndex);
}

/** The registry's definitions in the flat Responses function shape. */
function toResponsesTools(tools: ClientToolRegistry | undefined): FunctionTool[] {
  return (tools?.definitions() ?? []).map(({ function: fn }) => ({
    type: "function",
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
    strict: false,
  }));
}

/** The turn's input as items: a string is one user message. */
function inputItems(input: unknown): ResponseInputItem[] {
  return typeof input === "string"
    ? [{ role: "user", content: input }]
    : (input as ResponseInputItem[]);
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
  tools?: ClientToolRegistry,
): AsyncGenerator<ChatStreamEvent> {
  if (request.signal?.aborted) return;

  // Accumulated state to assemble in completed.
  let speech_text = "";
  // express is emitted per cue (beat). Completed envelope carries last cue as fallback.
  let express: ExpressArgs | undefined;
  // A response carries at most one reasoning summary at a time; a later part is a new paragraph.
  let sawSummaryPart = false;
  // Monotonic across the turn: a synthesized call_id must stay unique in the whole input.
  let seq = 0;

  // instructions: request override (if non-empty takes priority) → falls back to config.chat_instructions.
  const effectiveInstructions = request.instructions?.trim()
    ? request.instructions
    : config.chat_instructions;
  const toolDefs = toResponsesTools(tools);
  // ChatRequest.input is deliberately unknown (OpenAI-compatible input, caller encodes) — narrow-cast
  // to the shape SDK expects only at the call site.
  let input = request.input as ResponseCreateParamsStreaming["input"];

  // State of the response being read; reset per request.
  // Same call (id, or output_index if absent) appears multiple times across added/done/arguments.done
  // but is handled once. Different calls each act (per-beat cue).
  let handled = new Set<string>();
  let callIds = new Map<string, string>();
  let executed: Array<{ call: ResponseInputItem; output: ToolOutputItem; oneWay: boolean }> = [];
  let roundText = "";

  async function* handleCall(
    key: string,
    name: string,
    argsJson: string,
  ): AsyncGenerator<ChatStreamEvent> {
    if (handled.has(key)) return;
    const outcome = yield* runClientCall(tools, name, argsJson);
    if (!outcome) return;
    handled.add(key);
    if (outcome.cue) express = outcome.cue;
    if (!outcome.run) return;
    const call_id = callIds.get(key) ?? `call_${seq++}`;
    executed.push({
      call: { type: "function_call", call_id, name, arguments: argsJson },
      output: { type: "function_call_output", call_id, output: outcome.run.result },
      oneWay: outcome.run.oneWay,
    });
  }

  for (let trips = 0; ; ) {
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
        ...(toolDefs.length ? { tools: toolDefs } : {}),
        input,
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

    handled = new Set();
    callIds = new Map();
    executed = [];
    roundText = "";
    // A response that errored is never answered.
    let failed = false;
    let roundTrip = false;

    try {
      for await (const event of stream) {
        if (request.signal?.aborted) return;

        switch (event.type) {
          case "response.output_text.delta": {
            speech_text += event.delta;
            roundText += event.delta;
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
              const key = callKey(item.id, event.output_index);
              if (item.call_id) callIds.set(key, item.call_id);
              if (!ownsCall(tools, item.name)) {
                yield { type: "tool_status", status: { state: "running", tool_id: item.name } };
              } else if (item.arguments) {
                // Live backend embeds complete arguments directly in added/done item.
                yield* handleCall(key, item.name, item.arguments);
              }
            }
            break;
          }

          case "response.function_call_arguments.done": {
            // native tool: completion handled at output_item.done.
            if (ownsCall(tools, event.name)) {
              yield* handleCall(
                callKey(event.item_id, event.output_index),
                event.name,
                event.arguments,
              );
            }
            break;
          }

          case "response.output_item.done": {
            const item = event.item;
            if (item?.type === "function_call") {
              const key = callKey(item.id, event.output_index);
              if (item.call_id) callIds.set(key, item.call_id);
              if (!ownsCall(tools, item.name)) {
                yield { type: "tool_status", status: { state: "done", tool_id: item.name } };
              } else {
                // Backends without function_call_arguments.* events have args only in done item.
                yield* handleCall(key, item.name, item.arguments ?? "");
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
            // Every call of this response precedes its completion, so the round trip is decided here.
            // The model waits on cue-only calls when its response said nothing.
            if (
              !failed &&
              shouldAnswer(executed, roundText === "") &&
              trips < MAX_TOOL_ROUND_TRIPS
            ) {
              roundTrip = true;
              break;
            }
            // Normalization: FLAT args → renderer seam shape.
            const envelope: ControlEnvelope = { speech_text };
            normalizeExpressIntoEnvelope(envelope, express);
            yield {
              type: "completed",
              envelope,
              responseId: event.response?.id ?? "",
              // Calls nobody answered leave the response unchainable until their outputs go with its id.
              ...(executed.length ? { toolOutputs: executed.map((e) => e.output) } : {}),
            };
            return;
          }

          case "error": {
            failed = true;
            yield { type: "error", message: event.message };
            break;
          }

          case "response.failed":
          case "response.incomplete": {
            // Terminal without completed — an error, not liveness: a dead turn must not
            // reset the caller's idle deadline.
            failed = true;
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
        // The decision is made at completion; the rest of this stream carries nothing the turn needs.
        if (roundTrip) break;
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

    // An aborted turn sends no further request.
    if (!roundTrip || request.signal?.aborted) return;
    trips++;
    // Starting a fresh request: the caller's idle watchdog measures the wait from here.
    yield { type: "keepalive" };
    input = [...inputItems(input), ...executed.flatMap((e) => [e.call, e.output])];
  }
}
