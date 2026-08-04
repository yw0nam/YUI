/**
 * Chat client — thin ADAPTER over the official `openai` SDK Responses stream.
 *
 * We do NOT hand-roll SSE/fetch/byte-framing. The SDK owns transport,
 * chunk-splitting and abort. We construct `new OpenAI({...})` and call
 * `client.responses.create({ stream: true })`, which returns an async-iterable of
 * TYPED Responses events. This module maps those events → our `ChatStreamEvent`
 * and assembles the final `ControlEnvelope`.
 *
 * Transport: Tauri webview gets CORS bypass + SSE streaming via the fetch injected by tauri-plugin-cors-fetch
 *   (plugin-http cannot stream SSE). `selectFetch()` chooses fetch per environment and injects it into
 *   `StreamChatOptions.fetch` for the SDK. dev/browser use global fetch.
 *
 * express tool naming: the tool is matched by SUFFIX (`name.endsWith("generate_express")`),
 *   so it recognizes both the plain `generate_express` and the MCP-namespaced
 *   `mcp_<server>_generate_express` the live backend emits. Sibling MCP tools
 *   (e.g. `..._get_ids`) do NOT match → they stay generic tool_status chips.
 *
 * express args shape: the spec streams args via response.function_call_arguments.done,
 *   but the live backend instead ships the complete `arguments` JSON inside the
 *   function_call item of response.output_item.added/done. Both paths are parsed;
 *   whichever arrives first for a given call wins. Hermes emits one generate_express
 *   per expressive beat — every distinct call emits its own express event, deduped
 *   per call (by function-call item id, falling back to output_index).
 *
 * Event → ChatStreamEvent mapping:
 *  - response.output_text.delta → speech_delta (accumulated into speech_text).
 *  - response.output_text.done  → speech_done.
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
 *    happens HERE (chat-client only): emotion_id→emotion{id}, motion_id→motion{id},
 *    emotion_text→emotion_text. Silence is an empty speech_text; no client-side speak gate.
 *  - error → error event.
 *
 * ⚠ function_call items are ABSENT from response.completed's final output[] →
 *   generate_express/tool state must be captured mid-stream and remembered until completed.
 *
 * Event shapes: openai@6.42 d.ts.
 */

import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type {
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";

import type {
  ControlEnvelope,
  EmotionId,
  EndpointsConfig,
  ExpressArgs,
  ToolStatus,
  Usage,
} from "../contract";
import { type CCMessage, createChunkReducer } from "./chat-completions";
import { isTauri } from "./tauri-env";

/** Incremental events streamed to client during parsing. */
export type ChatStreamEvent =
  | { type: "speech_delta"; text: string }
  | { type: "speech_done"; text: string }
  | { type: "express"; args: ExpressArgs }
  | { type: "tool_status"; status: ToolStatus }
  | { type: "usage"; usage: Usage }
  | { type: "completed"; envelope: ControlEnvelope; responseId: string }
  | { type: "error"; message: string; status?: number }
  /** wire activity during reasoning — resets the caller's idle watchdog without ending "thinking". */
  | { type: "keepalive" };

/**
 * Creates a client via `new OpenAI(opts)`. The real SDK is an ES class requiring `new`,
 * but some test mocks (arrow-wrapped factories) cannot be called as constructors → only
 * for "not a constructor" fallback to plain call. Normal path (real SDK) always uses `new`.
 */
function makeClient(opts: ConstructorParameters<typeof OpenAI>[0]): OpenAI {
  try {
    return new OpenAI(opts);
  } catch (err) {
    if (err instanceof TypeError && /is not a constructor/.test(err.message)) {
      return (OpenAI as unknown as (o: typeof opts) => OpenAI)(opts);
    }
    throw err;
  }
}

/**
 * Identifies express tool — when backend registers via MCP, name arrives as `mcp_<server>_generate_express`.
 * Matches by suffix to catch both namespaced/plain variants, while sibling tools
 * (`..._get_ids` etc) remain as generic tool_status.
 */
function isExpressTool(name: unknown): boolean {
  return typeof name === "string" && name.endsWith("generate_express");
}

/**
 * Per-call dedup key — one generate_express call shares the same function-call item id across
 * added/done/arguments.done. Falls back to output_index if id is absent.
 */
function expressCallKey(id: unknown, outputIndex: unknown): string {
  return typeof id === "string" && id.length > 0 ? id : String(outputIndex);
}

/** Extracts openai SDK APIError.status (HTTP status code) — undefined if absent (plain Error etc). */
function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
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

/** FLAT express args → renderer seam shape. Only present fields are normalized (no invention). */
function normalizeExpressIntoEnvelope(
  envelope: ControlEnvelope,
  express: ExpressArgs | undefined,
): void {
  if (!express) return;
  if (express.emotion_id !== undefined) envelope.emotion = { id: express.emotion_id as EmotionId };
  if (express.motion_id !== undefined) envelope.motion = { id: express.motion_id };
  if (express.emotion_text !== undefined) envelope.emotion_text = express.emotion_text;
}

export interface ChatRequest {
  /** OpenAI-compatible input (messages / input items). Includes InputContext encoding. */
  input: unknown;
  /** Server-side conversation state (Responses API). */
  previous_response_id?: string;
  /** Responses reasoning.effort / Chat Completions top-level reasoning_effort. Omitted if unset. */
  reasoning_effort?: "none" | "minimal" | "low" | "medium";
  /** instructions runtime override. Non-empty takes precedence over config.chat_instructions. Responses only (CC already in messages). */
  instructions?: string;
  /** Mid-flight abort. */
  signal?: AbortSignal;
  /** Chat Completions mode: pre-assembled messages (chat-completions.buildCCMessages). Used when config.chat_api==="chat_completions". */
  messages?: CCMessage[];
}

export interface StreamChatOptions {
  /**
   * Hermes auth key (Bearer). SecretProvider resolves and caller passes it.
   * Unset defaults to unauthenticated local placeholder — backends enforcing keys return 401.
   */
  apiKey?: string;
  /** Transport fetch override. Tauri uses cors-fetch's fetchCORS, dev/browser undefined (global fetch). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Selects fetch per environment. Tauri webview uses `fetchCORS` injected by tauri-plugin-cors-fetch
 * (CORS bypass + SSE streaming). Browser/vitest undefined → global fetch.
 */
export async function selectFetch(): Promise<typeof globalThis.fetch | undefined> {
  const g = globalThis as { fetchCORS?: unknown };
  if (isTauri()) {
    if (typeof g.fetchCORS === "function") return g.fetchCORS as typeof globalThis.fetch;
  }
  return undefined;
}

/**
 * Selects baseURL. Tauri uses absolute URLs directly via cors-fetch. Dev web rewrites to same-origin
 * `/__hermes` proxy mount to avoid CORS preflight. Prod web/no origin pass through unchanged.
 *
 * Chat Completions mode (chatApi==="chat_completions") always skips this rewrite — `/__hermes` is
 * hard-proxied to Responses backend, preventing CC requests silently going to wrong server instead of
 * user-configured chat_base_url (CC servers provide own CORS or local dev options).
 */
export function selectChatBaseUrl(
  configuredBaseUrl: string,
  env?: { isTauri?: boolean; isDev?: boolean; origin?: string },
  chatApi?: EndpointsConfig["chat_api"],
): string {
  if (chatApi === "chat_completions") return configuredBaseUrl;

  const g = globalThis as { location?: { origin?: string } };
  const tauriRuntime = env?.isTauri ?? isTauri();
  const isDev = env?.isDev ?? import.meta.env?.DEV;
  const origin = env?.origin ?? g.location?.origin;

  if (tauriRuntime) return configuredBaseUrl;
  if (isDev && origin) {
    let path = configuredBaseUrl;
    if (/^[a-z]+:\/\//i.test(configuredBaseUrl)) {
      path = new URL(configuredBaseUrl).pathname;
    }
    if (!path.startsWith("/")) path = `/${path}`;
    return `${origin}/__hermes${path}`;
  }
  return configuredBaseUrl;
}

/**
 * Calls Responses API stream. Official `openai` SDK adapter.
 *
 * SDK owns transport/abort so we don't handle fetch/SSE directly. Pass request.signal to create()
 * to delegate in-flight abort to SDK, and guard once before loop entry.
 */
export async function* streamChat(
  config: EndpointsConfig,
  request: ChatRequest,
  opts: StreamChatOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  // Abort immediately without hang if signal already aborted.
  if (request.signal?.aborted) return;

  // SDK appends /responses after baseURL, so baseURL is the API root (e.g., .../v1).
  // Unset apiKey defaults to unauthenticated placeholder.
  const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
    baseURL: selectChatBaseUrl(config.chat_base_url, undefined, config.chat_api),
    apiKey: opts.apiKey ?? "yui-local-placeholder",
    dangerouslyAllowBrowser: true,
  };
  if (opts.fetch != null) {
    clientOpts.fetch = opts.fetch;
  }
  const client = makeClient(clientOpts);

  if (config.chat_api === "chat_completions") {
    yield* streamChatCompletions(client, config, request);
    return;
  }

  // Accumulated state to assemble in completed.
  let speech_text = "";
  // express is emitted per cue (beat). Completed envelope carries last cue as fallback.
  let express: ExpressArgs | undefined;
  let tool_status: ToolStatus | undefined;
  // Same call (id, or output_index if absent) appears multiple times across added/done/arguments.done
  // but emits once. Different calls each emit (per-beat cue).
  const emittedExpressKeys = new Set<string>();

  // instructions: request override (if non-empty takes priority) → falls back to config.chat_instructions.
  const effectiveInstructions = request.instructions?.trim()
    ? request.instructions
    : config.chat_instructions;

  let stream: AsyncIterable<ResponseStreamEvent>;
  try {
    const params: ResponseCreateParamsStreaming = {
      // model: config-driven (EndpointsConfig.chat_model). Hermes Responses requires model —
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
        message: `chat request failed: ${err instanceof Error ? err.message : String(err)}`,
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
          if (tool_status) envelope.tool_status = tool_status;
          yield { type: "completed", envelope, responseId: event.response?.id ?? "" };
          break;
        }

        case "error": {
          yield { type: "error", message: event.message };
          break;
        }

        default:
          // Unhandled events (reasoning deltas, backend heartbeats during long work such as
          // context compaction) carry no payload but prove the wire is alive.
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
      yield {
        type: "error",
        message: `chat stream failed: ${err instanceof Error ? err.message : String(err)}`,
        status,
      };
      return;
    }
    // Status-less network reject mid-stream → terminate silently.
    // Intentional asymmetry: create() catch exposes non-abort errors, but mid-stream
    //   drop here stays silent because partial output already reached consumer and frequency is low.
    return;
  }
}

/**
 * Calls Chat Completions API stream — `client.chat.completions.create({ stream: true })`.
 *
 * ONE-WAY parse: caller (backend-caller) pre-assembles request.messages via chat-completions.ts
 * buildCCMessages — this just passes through (no branch logic). Server reads published broker vocabulary
 * and emits generate_express; this function only parses tool_call from stream — client neither declares
 * tools nor sends results back (single POST, no round-trip).
 *
 * Stream chunks normalized via chat-completions.createChunkReducer. tool_call processed inline on arrival
 * (express → express event, else → tool_status done) — finish_reason no longer branches (no round-trip, not actionable).
 */
/** SDK requires model, but model-less mock/backend omit the field itself — locally relax optional. */
type CCCreateParams = Omit<ChatCompletionCreateParamsStreaming, "model"> & {
  model?: ChatCompletionCreateParamsStreaming["model"];
};

async function* streamChatCompletions(
  client: OpenAI,
  config: EndpointsConfig,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  if (request.signal?.aborted) return;

  let speech_text = "";
  let express: ExpressArgs | undefined;

  // The reducer flushes each tool_call exactly once (buffers clear on flush), so no dedup here.
  function* handleToolCall(item: {
    id: string | undefined;
    name: string;
    argsJson: string;
  }): Generator<ChatStreamEvent> {
    if (isExpressTool(item.name)) {
      const result = parseExpressArgs(item.argsJson);
      if ("args" in result) {
        express = result.args;
        yield { type: "express", args: result.args };
      } else {
        yield { type: "error", message: result.error };
      }
    } else {
      yield { type: "tool_status", status: { state: "done", tool_id: item.name } };
    }
  }

  let stream: AsyncIterable<ChatCompletionChunk>;
  try {
    const params: CCCreateParams = {
      ...(config.chat_model ? { model: config.chat_model } : {}),
      // CCMessage (chat-completions.ts) is loose structural type, not discriminated union per role —
      // runtime shape (role/content) matches SDK's ChatCompletionMessageParam.
      messages: (request.messages ?? []) as unknown as ChatCompletionMessageParam[],
      ...(request.reasoning_effort ? { reasoning_effort: request.reasoning_effort } : {}),
      stream: true,
      stream_options: { include_usage: true },
    };
    // CCCreateParams allows model omission → narrow-cast to SDK's required-model type at call site.
    stream = await client.chat.completions.create(params as ChatCompletionCreateParamsStreaming, {
      signal: request.signal,
    });
  } catch (err) {
    if (!request.signal?.aborted) {
      const status = httpStatusOf(err);
      yield {
        type: "error",
        message: `chat request failed: ${err instanceof Error ? err.message : String(err)}`,
        ...(status !== undefined ? { status } : {}),
      };
    }
    return;
  }

  const reducer = createChunkReducer();

  try {
    for await (const chunk of stream) {
      if (request.signal?.aborted) return;
      for (const item of reducer.feed(chunk)) {
        switch (item.kind) {
          case "text":
            speech_text += item.text;
            yield { type: "speech_delta", text: item.text };
            break;
          case "tool_call":
            yield* handleToolCall(item);
            break;
          case "usage":
            yield {
              type: "usage",
              usage: {
                input_tokens: item.usage.input_tokens ?? 0,
                output_tokens: item.usage.output_tokens ?? 0,
                total_tokens: item.usage.total_tokens ?? 0,
              },
            };
            break;
        }
      }
    }
  } catch {
    // Abort/network reject mid-stream → terminate silently (same policy as Responses branch).
    return;
  }
  // When stream ends without finish_reason (abnormal termination) drain incomplete buffer.
  for (const item of reducer.finish()) {
    if (item.kind === "tool_call") yield* handleToolCall(item);
  }

  yield { type: "speech_done", text: speech_text };
  const envelope: ControlEnvelope = { speech_text };
  normalizeExpressIntoEnvelope(envelope, express);
  yield { type: "completed", envelope, responseId: "" };
}
