/**
 * Chat client — thin ADAPTER over the official `openai` SDK Responses stream.
 * (PRD F6 / contract.md §3, decision D-CHAT-SDK)
 *
 * D-CHAT-SDK: we do NOT hand-roll SSE/fetch/byte-framing. The SDK owns transport,
 * chunk-splitting and abort. We construct `new OpenAI({...})` and call
 * `client.responses.create({ stream: true })`, which returns an async-iterable of
 * TYPED Responses events. This module maps those events → our `ChatStreamEvent`
 * and assembles the final `ControlEnvelope`.
 *
 * Event → ChatStreamEvent mapping:
 *  - response.output_text.delta → speech_delta (accumulated into speech_text).
 *  - response.output_text.done  → speech_done.
 *  - response.output_item.added (function_call, name != "express") → tool_status running.
 *  - response.function_call_arguments.done:
 *      · name == "express" → JSON.parse(arguments) → ExpressArgs (emotion?/motion?/should_speak?).
 *        parse failure → error event (does NOT throw / abort the loop).
 *      · native tool → no event here (completion handled at output_item.done).
 *  - response.output_item.done (function_call, name != "express") → tool_status done.
 *  - response.completed → completed event with the assembled ControlEnvelope.
 *  - error → error event.
 *
 * ⚠ function_call items are ABSENT from response.completed's final output[] →
 *   express/tool state must be captured mid-stream and remembered until completed.
 *
 * Event shapes: openai@6.42 d.ts + docs/openai_response_sdk/sse-event-format.md.
 */

import OpenAI from "openai";

import type {
  ControlEnvelope,
  EndpointsConfig,
  ExpressArgs,
  ToolStatus,
} from "../contract";

/** 스트림 파싱 중 client로 흘리는 증분 이벤트. */
export type ChatStreamEvent =
  | { type: "speech_delta"; text: string }
  | { type: "speech_done"; text: string }
  | { type: "express"; args: ExpressArgs }
  | { type: "tool_status"; status: ToolStatus }
  | { type: "completed"; envelope: ControlEnvelope }
  | { type: "error"; message: string };

/**
 * `new OpenAI(opts)` 로 클라이언트를 만든다. 실제 SDK는 ES class라 `new`가 필요하지만,
 * 일부 테스트 mock(arrow-wrapped factory)은 생성자로 호출되지 못한다 → "not a constructor"
 * 에 한해 평범한 호출로 폴백한다. 정상 경로(real SDK)는 항상 `new`를 탄다.
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

export interface ChatRequest {
  /** OpenAI 호환 input (messages / input items). contract.md §4 InputContext 인코딩 포함. */
  input: unknown;
  /** server-side 대화 상태 (Responses API). */
  previous_response_id?: string;
  /** 중도 취소 (event-dispatcher.md §12 in-flight abort). */
  signal?: AbortSignal;
}

/**
 * Responses API 스트림 호출. 공식 `openai` SDK 어댑터.
 *
 * SDK가 transport/abort를 소유하므로 fetch/SSE를 직접 다루지 않는다. create() 호출에
 * request.signal을 전달해 in-flight abort를 SDK에 위임하고, 루프 진입 전에도 한 번 guard한다.
 */
export async function* streamChat(
  config: EndpointsConfig,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  // 이미 abort된 signal이면 hang 없이 즉시 종료.
  if (request.signal?.aborted) return;

  // TODO: real apiKey → OS keychain (M2). SDK는 baseURL 뒤에 /responses를 자체 append하므로
  // baseURL은 API root(chat_base_url)다.
  const client = makeClient({
    baseURL: config.chat_base_url,
    apiKey: "yui-local-placeholder",
    dangerouslyAllowBrowser: true,
  });

  // completed에서 조립할 누적 상태.
  let speech_text = "";
  let express: ExpressArgs | undefined;
  let tool_status: ToolStatus | undefined;

  let stream: AsyncIterable<any>;
  try {
    stream = (await client.responses.create(
      {
        input: request.input as any,
        previous_response_id: request.previous_response_id,
        stream: true,
      },
      { signal: request.signal },
    )) as unknown as AsyncIterable<any>;
  } catch {
    // SDK가 aborted signal 등에 reject할 수 있다 → 조용히 종료(hang 방지).
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
          if (
            item?.type === "function_call" &&
            item.name !== "express"
          ) {
            tool_status = { state: "running", tool_id: item.name };
            yield { type: "tool_status", status: tool_status };
          }
          break;
        }

        case "response.function_call_arguments.done": {
          if (event.name === "express") {
            try {
              const args = JSON.parse(event.arguments) as ExpressArgs;
              express = args;
              yield { type: "express", args };
            } catch (err) {
              yield {
                type: "error",
                message: `express arguments JSON parse failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              };
              // CONTINUE — never throw, never abort the loop.
            }
          }
          // native tool: 완료는 output_item.done에서 처리.
          break;
        }

        case "response.output_item.done": {
          const item = event.item;
          if (
            item?.type === "function_call" &&
            item.name !== "express"
          ) {
            tool_status = { state: "done", tool_id: item.name };
            yield { type: "tool_status", status: tool_status };
          }
          break;
        }

        case "response.completed": {
          const envelope: ControlEnvelope = { speech_text };
          if (express) {
            if (express.should_speak !== undefined)
              envelope.should_speak = express.should_speak;
            if (express.emotion !== undefined) envelope.emotion = express.emotion;
            if (express.motion !== undefined) envelope.motion = express.motion;
          }
          if (tool_status) envelope.tool_status = tool_status;
          yield { type: "completed", envelope };
          break;
        }

        case "error": {
          yield { type: "error", message: event.message };
          break;
        }

        default:
          break;
      }
    }
  } catch {
    // 스트림 도중 abort/네트워크 reject → 조용히 종료.
    return;
  }
}
