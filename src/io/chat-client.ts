/**
 * Chat client — Hermes Responses API SSE 파서. (placeholder, PRD F6 / contract.md §3)
 *
 * 책임(M1+): POST {chat_base_url}{chat_endpoint} (default /v1/responses) 스트림을 파싱해
 *  - message item: response.output_text.delta → speech_text 누적, .done으로 종료.
 *  - function_call item:
 *      · name == "express" → arguments(JSON) 파싱 → ExpressArgs { emotion?, motion?, should_speak? }.
 *      · Hermes 네이티브 tool(web_search/terminal/browser 등) → tool_status 관찰 도출.
 *
 * ⚠ function_call은 response.completed의 최종 output[]에 빠진다 →
 *   response.function_call_arguments.done 시점에 스트림 진행 중 캡처해야 한다.
 *
 * SSE event 형식 원천: docs/openai_response_sdk/sse-event-format.md
 *   (response.created / output_item.added / output_text.delta / output_text.done /
 *    function_call_arguments.delta / function_call_arguments.done / output_item.done /
 *    response.completed / error).
 *
 * 지금은 시그니처/타입만. 실제 fetch + SSE 파싱은 M1.
 */

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

export interface ChatRequest {
  /** OpenAI 호환 input (messages / input items). contract.md §4 InputContext 인코딩 포함. */
  input: unknown;
  /** server-side 대화 상태 (Responses API). */
  previous_response_id?: string;
  /** 중도 취소 (event-dispatcher.md §12 in-flight abort). */
  signal?: AbortSignal;
}

/**
 * Responses API 스트림 호출 (placeholder).
 * TODO(M1): fetch SSE → 라인 파싱 → output_index별 item 누적 → ChatStreamEvent yield.
 */
export async function* streamChat(
  _config: EndpointsConfig,
  _request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  // TODO(M1): SSE 파서 구현. 현재는 즉시 종료하는 빈 스트림.
  return;
}
