import type OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import type { ControlEnvelope, EndpointsConfig, ExpressArgs } from "../../contract";
import type { ChatRequest, ChatStreamEvent } from "./chat-client";
import { type CCMessage, type CCToolCall, createChunkReducer } from "./chat-completions";
import type { ClientToolRegistry } from "./client-tools";
import {
  httpStatusOf,
  isExpressTool,
  normalizeExpressIntoEnvelope,
  serverMessageOf,
} from "./stream-helpers";

function parseToolArgs(raw: string): { args: Record<string, unknown> } | { error: string } {
  if (raw.trim() === "") return { args: {} };
  try {
    return { args: JSON.parse(raw) as Record<string, unknown> };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Calls Chat Completions API stream — `client.chat.completions.create({ stream: true })`.
 *
 * The caller (backend-caller) pre-assembles request.messages via chat-completions.ts
 * buildCCMessages; the registry (opts.tools) supplies the tools declared on every request of the
 * turn. Stream chunks are normalized via chat-completions.createChunkReducer and each tool_call is
 * handled on arrival: an express call yields its cue immediately (cue timing never waits for the
 * round trip), any other call yields tool_status done, and a call naming a registered tool is
 * executed locally.
 *
 * Round trip: the assistant tool_calls message and one role:"tool" result per call are appended to
 * the in-turn message array and the whole array is sent again. It happens whenever a tool that
 * answers a question ran, and — for cue-only (oneWay) tools, whose result says nothing — only when
 * the model stopped to wait for it: finish_reason "tool_calls" with no speech in that response.
 * A response that already spoke its cues is a finished turn; answering it would make the model say
 * everything again. Bounded by MAX_TOOL_ROUND_TRIPS; past that the client stops returning results
 * and closes the turn with the text it has.
 *
 * The array is copied on append, so the caller's messages are never mutated and nothing crosses
 * turn boundaries: CC has no previous_response_id and the next turn is rebuilt from the transcript.
 */
/** SDK requires model, but model-less mock/backend omit the field itself — locally relax optional. */
type CCCreateParams = Omit<ChatCompletionCreateParamsStreaming, "model"> & {
  model?: ChatCompletionCreateParamsStreaming["model"];
};

/** Tool round trips per turn. */
const MAX_TOOL_ROUND_TRIPS = 3;

export async function* streamChatCompletions(
  client: OpenAI,
  config: EndpointsConfig,
  request: ChatRequest,
  tools?: ClientToolRegistry,
): AsyncGenerator<ChatStreamEvent> {
  if (request.signal?.aborted) return;

  let speech_text = "";
  let express: ExpressArgs | undefined;
  let messages: CCMessage[] = request.messages ?? [];
  const toolDefs = tools?.definitions() ?? [];
  // Calls executed in the response being read — the next request's round-trip payload.
  let executed: Array<{ call: CCToolCall; result: string; oneWay: boolean }> = [];
  // Monotonic across the turn: a synthesized id must stay unique in the whole message array.
  let seq = 0;

  // The reducer flushes each tool_call exactly once (buffers clear on flush), so no dedup here.
  async function* handleToolCall(item: {
    id: string | undefined;
    name: string;
    argsJson: string;
  }): AsyncGenerator<ChatStreamEvent> {
    const tool = tools?.get(item.name);
    const express_call = isExpressTool(item.name);
    // A call the client did not register runs on the backend — observed, never answered.
    if (!tool && !express_call) {
      yield { type: "tool_status", status: { state: "done", tool_id: item.name } };
      return;
    }

    const parsed = parseToolArgs(item.argsJson);
    if ("error" in parsed) {
      yield { type: "error", message: `${item.name} arguments JSON parse failed: ${parsed.error}` };
      return;
    }

    if (express_call) {
      express = parsed.args as ExpressArgs;
      yield { type: "express", args: express };
    }

    if (!tool) return;
    // The client owns this call, so the chip runs for as long as the call does.
    if (!express_call)
      yield { type: "tool_status", status: { state: "running", tool_id: tool.name } };
    let result: string;
    try {
      result = await tool.execute(parsed.args);
    } catch (err) {
      // The model owns what a failed tool means — hand it the failure rather than dropping the turn.
      result = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (!express_call) yield { type: "tool_status", status: { state: "done", tool_id: tool.name } };
    executed.push({
      call: {
        id: item.id ?? `call_${seq++}`,
        type: "function",
        function: { name: item.name, arguments: item.argsJson },
      },
      result,
      oneWay: tool.oneWay === true,
    });
  }

  for (let trips = 0; ; ) {
    let stream: AsyncIterable<ChatCompletionChunk>;
    try {
      const params: CCCreateParams = {
        ...(config.chat_model ? { model: config.chat_model } : {}),
        // CCMessage (chat-completions.ts) is loose structural type, not discriminated union per role —
        // runtime shape (role/content) matches SDK's ChatCompletionMessageParam.
        messages: messages as unknown as ChatCompletionMessageParam[],
        ...(toolDefs.length
          ? { tools: toolDefs as unknown as ChatCompletionCreateParamsStreaming["tools"] }
          : {}),
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
          message: serverMessageOf(err),
          ...(status !== undefined ? { status } : {}),
        };
      }
      return;
    }

    executed = [];
    // Speech from this response alone, and how it ended — together they say whether the model is
    // waiting on results or has finished the turn.
    let roundText = "";
    let finishReason: string | undefined;
    const reducer = createChunkReducer();

    try {
      for await (const chunk of stream) {
        if (request.signal?.aborted) return;
        for (const item of reducer.feed(chunk)) {
          switch (item.kind) {
            case "text":
              speech_text += item.text;
              roundText += item.text;
              yield { type: "speech_delta", text: item.text };
              break;
            case "tool_call":
              yield* handleToolCall(item);
              break;
            case "finish":
              finishReason = item.reason;
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

    // A tool that answers a question is always answered back. Cue-only calls are answered only
    // when the model stopped to wait for them (finish_reason "tool_calls") and said nothing —
    // a response that already spoke would otherwise be asked to speak it all over again.
    const answerable =
      executed.some((e) => !e.oneWay) || (finishReason === "tool_calls" && roundText === "");
    if (executed.length === 0 || !answerable || trips >= MAX_TOOL_ROUND_TRIPS) break;
    trips++;
    // Starting a fresh request: the caller's idle watchdog measures the wait from here.
    yield { type: "keepalive" };
    messages = [
      ...messages,
      { role: "assistant", content: null, tool_calls: executed.map((e) => e.call) },
      ...executed.map(
        (e): CCMessage => ({ role: "tool", tool_call_id: e.call.id, content: e.result }),
      ),
    ];
  }

  yield { type: "speech_done", text: speech_text };
  const envelope: ControlEnvelope = { speech_text };
  normalizeExpressIntoEnvelope(envelope, express);
  yield { type: "completed", envelope, responseId: "" };
}
