/**
 * Chat client — thin ADAPTER over the official `openai` SDK Responses stream.
 *
 * We do NOT hand-roll SSE/fetch/byte-framing. The SDK owns transport,
 * chunk-splitting and abort. We construct `new OpenAI({...})` and call
 * `client.responses.create({ stream: true })`, which returns an async-iterable of
 * TYPED Responses events. This module maps those events → our `ChatStreamEvent`
 * and assembles the final `ControlEnvelope`.
 *
 * Transport: Tauri webview는 tauri-plugin-cors-fetch가 주입한 fetch로 CORS 우회 + SSE 스트리밍을
 *   얻는다(plugin-http는 SSE 스트리밍 불가). `selectFetch()`가 환경별 fetch를 골라
 *   `StreamChatOptions.fetch`로 SDK에 주입한다. dev/browser는 글로벌 fetch.
 *
 * express tool naming: the tool is matched by SUFFIX (`name.endsWith("generate_express")`),
 *   so it recognizes both the plain `generate_express` and the MCP-namespaced
 *   `mcp_<server>_generate_express` the live backend emits. Sibling MCP tools
 *   (e.g. `..._get_ids`) do NOT match → they stay generic tool_status chips.
 *
 * express args shape: the spec streams args via response.function_call_arguments.done,
 *   but the live backend instead ships the complete `arguments` JSON inside the
 *   function_call item of response.output_item.added/done. Both paths are parsed;
 *   whichever arrives first wins (express is emitted exactly once per turn).
 *
 * Event → ChatStreamEvent mapping:
 *  - response.output_text.delta → speech_delta (accumulated into speech_text).
 *  - response.output_text.done  → speech_done.
 *  - response.output_item.added (function_call):
 *      · isExpressTool(name) → if item.arguments present, JSON.parse → express (once).
 *      · else → tool_status running.
 *  - response.function_call_arguments.done:
 *      · isExpressTool(name) → JSON.parse(arguments) → ExpressArgs (once)
 *        (FLAT: emotion_id?/motion_id?/emotion_text?). parse failure → error event
 *        (does NOT throw / abort the loop).
 *      · native tool → no event here (completion handled at output_item.done).
 *  - response.output_item.done (function_call):
 *      · isExpressTool(name) → if not yet emitted and item.arguments present,
 *        JSON.parse → express (covers backends with no function_call_arguments.* events).
 *      · else → tool_status done.
 *  - response.completed → completed event with the assembled ControlEnvelope. Normalization
 *    happens HERE (chat-client only): emotion_id→emotion{id}, motion_id→motion{id},
 *    emotion_text→emotion_text. No should_speak gate.
 *  - error → error event.
 *
 * ⚠ function_call items are ABSENT from response.completed's final output[] →
 *   generate_express/tool state must be captured mid-stream and remembered until completed.
 *
 * Event shapes: openai@6.42 d.ts + docs/openai_response_sdk/sse-event-format.md.
 */

import OpenAI from "openai";

import type {
  ControlEnvelope,
  EmotionId,
  EndpointsConfig,
  ExpressArgs,
  ToolStatus,
  Usage,
} from "../contract";

/** 스트림 파싱 중 client로 흘리는 증분 이벤트. */
export type ChatStreamEvent =
  | { type: "speech_delta"; text: string }
  | { type: "speech_done"; text: string }
  | { type: "express"; args: ExpressArgs }
  | { type: "tool_status"; status: ToolStatus }
  | { type: "usage"; usage: Usage }
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

/**
 * express tool 식별 — backend가 MCP로 등록하면 이름이 `mcp_<server>_generate_express`로
 * namespaced되어 온다. suffix로 매칭해 namespaced/plain 둘 다 잡되, sibling tool
 * (`..._get_ids` 등)은 generic tool_status로 남긴다.
 */
function isExpressTool(name: unknown): boolean {
  return typeof name === "string" && name.endsWith("generate_express");
}

/** express arguments JSON 문자열 파싱. 실패 시 throw 없이 error 메시지를 돌려준다. */
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

export interface ChatRequest {
  /** OpenAI 호환 input (messages / input items). InputContext 인코딩 포함. */
  input: unknown;
  /** server-side 대화 상태 (Responses API). */
  previous_response_id?: string;
  /** Responses reasoning.effort. omit => no reasoning param sent. ("default" maps to omitting upstream.) */
  reasoning_effort?: "low" | "medium" | "high";
  /** instructions 런타임 오버라이드. 비어있지 않으면 config.chat_instructions 대신 사용. */
  instructions?: string;
  /** 중도 취소 (in-flight abort). */
  signal?: AbortSignal;
}

export interface StreamChatOptions {
  /**
   * Hermes 인증 키(Bearer). SecretProvider에서 해소해 caller가 넘긴다.
   * 미지정 시 무인증 로컬용 placeholder — 키를 강제하는 백엔드엔 401이 난다.
   */
  apiKey?: string;
  /** Transport fetch override. Tauri=cors-fetch의 fetchCORS, dev/browser=undefined(글로벌 fetch). */
  fetch?: typeof globalThis.fetch;
  /** client-owned Hermes session id, sent per-request as the X-Hermes-Session-Id header. */
  sessionId?: string;
}

/**
 * 환경별 fetch 선택. Tauri webview는 tauri-plugin-cors-fetch가 주입한 `fetchCORS`를 쓴다
 * (CORS 우회 + SSE 스트리밍). 브라우저/vitest는 undefined → 글로벌 fetch.
 */
export async function selectFetch(): Promise<typeof globalThis.fetch | undefined> {
  if ((globalThis as any).__TAURI_INTERNALS__) {
    const corsFetch = (globalThis as any).fetchCORS;
    if (typeof corsFetch === "function") return corsFetch as typeof globalThis.fetch;
  }
  return undefined;
}

/**
 * baseURL 선택. Tauri는 cors-fetch로 절대 URL을 그대로 쓴다. dev web은 같은 출처
 * `/__hermes` 프록시 마운트로 다시 써 CORS preflight를 피한다. prod web/출처 없음은 그대로.
 */
export function selectChatBaseUrl(
  configuredBaseUrl: string,
  env?: { isTauri?: boolean; isDev?: boolean; origin?: string },
): string {
  const isTauri = env?.isTauri ?? !!(globalThis as any).__TAURI_INTERNALS__;
  const isDev = env?.isDev ?? (import.meta as any).env?.DEV;
  const origin = env?.origin ?? (globalThis as any).location?.origin;

  if (isTauri) return configuredBaseUrl;
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
 * Responses API 스트림 호출. 공식 `openai` SDK 어댑터.
 *
 * SDK가 transport/abort를 소유하므로 fetch/SSE를 직접 다루지 않는다. create() 호출에
 * request.signal을 전달해 in-flight abort를 SDK에 위임하고, 루프 진입 전에도 한 번 guard한다.
 */
export async function* streamChat(
  config: EndpointsConfig,
  request: ChatRequest,
  opts: StreamChatOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  // 이미 abort된 signal이면 hang 없이 즉시 종료.
  if (request.signal?.aborted) return;

  // SDK는 baseURL 뒤에 /responses를 자체 append하므로 baseURL은 API root(예: .../v1)다.
  // apiKey 미지정 시 무인증 placeholder.
  const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
    baseURL: selectChatBaseUrl(config.chat_base_url),
    apiKey: opts.apiKey ?? "yui-local-placeholder",
    dangerouslyAllowBrowser: true,
  };
  if (opts.fetch != null) {
    clientOpts.fetch = opts.fetch;
  }
  const client = makeClient(clientOpts);

  // completed에서 조립할 누적 상태.
  let speech_text = "";
  let express: ExpressArgs | undefined;
  let tool_status: ToolStatus | undefined;
  // express는 added/done/arguments.done 어디서 와도 한 번만 emit한다(중복 방지).
  let expressEmitted = false;

  // instructions: 요청 오버라이드(비어있지 않으면 우선) → config.chat_instructions로 폴백.
  const effectiveInstructions = request.instructions?.trim()
    ? request.instructions
    : config.chat_instructions;

  let stream: AsyncIterable<any>;
  try {
    stream = (await client.responses.create(
      {
        // model: config-driven (EndpointsConfig.chat_model). Hermes Responses는 model 필수 —
        // 미설정 시 생략(테스트 mock·model-less backend용). prod endpoints.json은 반드시 설정.
        ...(config.chat_model ? { model: config.chat_model } : {}),
        // instructions: 요청 오버라이드 우선, 없으면 config nudge. 둘 다 없으면 생략.
        ...(effectiveInstructions ? { instructions: effectiveInstructions } : {}),
        // reasoning.effort: 요청에 있을 때만 전달("default"는 상위에서 생략으로 매핑).
        ...(request.reasoning_effort ? { reasoning: { effort: request.reasoning_effort } } : {}),
        input: request.input as any,
        previous_response_id: request.previous_response_id,
        stream: true,
      },
      {
        signal: request.signal,
        // session id rotates between turns → per-request header, never defaultHeaders.
        headers: opts.sessionId ? { "X-Hermes-Session-Id": opts.sessionId } : undefined,
      },
    )) as unknown as AsyncIterable<any>;
  } catch (err) {
    // aborted signal이면 조용히 종료(hang 방지). 그 외(401 인증 실패 / 네트워크 등)는 무음으로
    // 삼키지 않고 error 이벤트로 노출한다 — placeholder 키 401이 "빈 스트림"으로 사라지는 함정 방지.
    if (!request.signal?.aborted) {
      yield {
        type: "error",
        message: `chat request failed: ${err instanceof Error ? err.message : String(err)}`,
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
              // 라이브 백엔드는 완성된 arguments를 added/done item에 바로 싣는다.
              if (!expressEmitted && item.arguments) {
                const result = parseExpressArgs(item.arguments);
                if ("args" in result) {
                  express = result.args;
                  expressEmitted = true;
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
          if (isExpressTool(event.name) && !expressEmitted) {
            const result = parseExpressArgs(event.arguments);
            if ("args" in result) {
              express = result.args;
              expressEmitted = true;
              yield { type: "express", args: result.args };
            } else {
              yield { type: "error", message: result.error };
              // CONTINUE — never throw, never abort the loop.
            }
          }
          // native tool: 완료는 output_item.done에서 처리.
          break;
        }

        case "response.output_item.done": {
          const item = event.item;
          if (item?.type === "function_call") {
            if (isExpressTool(item.name)) {
              // function_call_arguments.* 이벤트가 없는 백엔드는 done item에만 args가 있다.
              if (!expressEmitted && item.arguments) {
                const result = parseExpressArgs(item.arguments);
                if ("args" in result) {
                  express = result.args;
                  expressEmitted = true;
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
          // 토큰 점유량은 자체 이벤트로만 흘린다(ControlEnvelope에 싣지 않음). usage 블록이
          // 통째로 없으면 emit 생략, 일부 누락 필드는 0으로 보정.
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
          //   emotion_id→emotion{id}, motion_id→motion{id}, emotion_text→emotion_text.
          //   Only present fields are normalized; absent ones stay undefined (no invention).
          const envelope: ControlEnvelope = { speech_text };
          if (express) {
            if (express.emotion_id !== undefined)
              envelope.emotion = { id: express.emotion_id as EmotionId };
            if (express.motion_id !== undefined) envelope.motion = { id: express.motion_id };
            if (express.emotion_text !== undefined) envelope.emotion_text = express.emotion_text;
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
    // 의도적 비대칭: create() catch는 non-abort 에러를 error로 노출하지만, 여기 mid-stream
    //   드롭은 부분 출력이 이미 consumer에 닿았고 빈도 낮아 무음 유지.
    return;
  }
}
