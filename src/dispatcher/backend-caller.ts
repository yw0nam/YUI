/**
 * Backend caller — B1–B5 호출 시퀀스. (PRD F6 / event-dispatcher.md §7.2)
 *
 * tier2/3 event를 backend judgment로 보낸다. firing≠judgment 경계의 backend 쪽:
 * 말할지/무엇을은 backend가 `express` tool-call(should_speak)로 결정한다.
 *
 *  B1 package_context — contract.md §4 InputContext 조립(MVP: user_text + env.timestamp +
 *     env.timezone). active_app/window(Rust handoff)는 DEFERRED(#26) → 채우지 않음.
 *  B2 POST — io/chat-client.streamChat(config, req, { fetch, apiKey }). SSE는 chat-client가
 *     소유 — 여기서 직접 파싱하지 않는다. AbortSignal로 in-flight abort(§12).
 *  B3 parse — chat-client의 `completed` 이벤트가 이미 ControlEnvelope를 조립해 준다(§3).
 *     completed 미수신 → parse_error.
 *  B4 judgment — should_speak=false → silent drop(INFO). (emotion/motion은 그래도 렌더.)
 *  B5 dispatch_to_renderer — renderer.applyDirective(envelope) + should_speak시 speech_text를
 *     onSpeech 콜백으로(TTS는 #14 deferred — 지금은 dev 로그/콜백).
 *
 * §7.3 silent drop 분류: parse_error(WARN) / network_drop(WARN) / should_speak_false(INFO).
 * 본 MVP는 retry/timeout 정교화(§7.2 B2 retry x1, 5s/30s)는 seam만 두고 단순화한다(#21 spine).
 */

import { streamChat, type ChatRequest } from "../io/chat-client";
import type { ControlEnvelope, EndpointsConfig, InputContext } from "../contract";
import type { Renderer } from "../renderer";
import type { BusEnvelope } from "./event-bus";
import type { DropReason } from "./guardrails";

/** §10 Dispatcher → Backend Caller 출력: { ok, drop_reason? }. */
export interface BackendCallResult {
  ok: boolean;
  drop_reason?: DropReason;
}

export interface BackendCallerDeps {
  /** chat endpoint config (contract §Endpoint). */
  config: EndpointsConfig;
  /** render directive sink (#16a applyDirective). */
  renderer: Pick<Renderer, "applyDirective">;
  /** Hermes 인증 키 해소(SecretProvider). 없으면 무인증 placeholder. */
  getApiKey: () => Promise<string | undefined>;
  /** transport fetch 선택(selectFetch, #44). Tauri=plugin-http, dev=undefined. */
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** 발화 텍스트 sink (TTS #14 deferred — 지금은 dev 로그/콜백). */
  onSpeech?: (text: string) => void;
  /** 단계별 로깅(없으면 console). */
  log?: (stage: string, detail: Record<string, unknown>) => void;
  /** client 버전(InputContext.client.yui_version). */
  yuiVersion?: string;
}

export interface BackendCaller {
  /**
   * 한 trigger envelope에 대해 B1–B5를 실행. externalSignal이 abort되면 in-flight 중단.
   * 절대 throw하지 않는다 — 실패는 { ok:false, drop_reason } 로 표현(dispatcher가 분기).
   */
  call(env: BusEnvelope, externalSignal?: AbortSignal): Promise<BackendCallResult>;
}

/** payload에서 user text 추출(user_input_source는 payload.text에 담는다). */
function userTextOf(env: BusEnvelope): string | undefined {
  const t = env.payload?.text;
  return typeof t === "string" ? t : undefined;
}

/** 안전한 timezone 조회(환경에 따라 throw 가능 → fallback). */
function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function createBackendCaller(deps: BackendCallerDeps): BackendCaller {
  const log =
    deps.log ?? ((stage, detail) => console.info(`[YUI][backend_caller] ${stage}`, detail));

  /**
   * B1: contract §4 InputContext 조립.
   * active_app / active_window_title / screenshot은 DEFERRED(#26/#20) → 생략(null/미포함).
   */
  function packageContext(env: BusEnvelope): InputContext {
    const userText = userTextOf(env);
    return {
      ...(userText !== undefined ? { user_text: userText } : {}),
      env: {
        timestamp: new Date(env.ts).toISOString(),
        timezone: resolveTimezone(),
      },
      client: { yui_version: deps.yuiVersion ?? "0.0.0" },
    };
  }

  /** InputContext → OpenAI Responses input (user 발화는 user 메시지로 인코딩). */
  function encodeInput(ctx: InputContext): ChatRequest["input"] {
    const text = ctx.user_text ?? "";
    // env 메타(시각/타임존)는 system 힌트로 동봉 — backend judgment가 시간 맥락을 쓸 수 있게.
    return [
      {
        role: "system",
        content: `client_context: ${JSON.stringify(ctx.env)}`,
      },
      { role: "user", content: text },
    ];
  }

  async function call(
    env: BusEnvelope,
    externalSignal?: AbortSignal,
  ): Promise<BackendCallResult> {
    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    // B1
    const ctx = packageContext(env);
    const input = encodeInput(ctx);
    log("backend_call", { event_name: env.event_name, seq_id: env.seq_id });

    // B2: fetch/apiKey 해소 후 streamChat. externalSignal을 그대로 전달(abort 위임, §12).
    let apiKey: string | undefined;
    let fetchImpl: typeof globalThis.fetch | undefined;
    try {
      [apiKey, fetchImpl] = await Promise.all([deps.getApiKey(), deps.getFetch()]);
    } catch (err) {
      log("backend_call.setup_failed", { error: String(err) });
      return { ok: false, drop_reason: "network_drop" };
    }

    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    // §12: in-flight fetch는 AbortController로 정리한다. 외부 signal(dispatcher의
    // supersede abort)을 내부 컨트롤러에 링크해 항상 단일 signal을 streamChat에 넘긴다.
    const ac = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) ac.abort();
      else externalSignal.addEventListener("abort", () => ac.abort(), { once: true });
    }
    const request: ChatRequest = { input, signal: ac.signal };

    // B3: chat-client의 completed 이벤트에서 ControlEnvelope 수령(SSE 재파싱 X).
    let envelope: ControlEnvelope | undefined;
    let streamError: string | undefined;
    try {
      for await (const ev of streamChat(deps.config, request, {
        apiKey,
        fetch: fetchImpl,
      })) {
        switch (ev.type) {
          case "completed":
            envelope = ev.envelope;
            break;
          case "error":
            streamError = ev.message;
            break;
          default:
            break;
        }
      }
    } catch (err) {
      // abort면 supersede, 그 외는 network drop.
      if (externalSignal?.aborted) {
        return { ok: false, drop_reason: "superseded_by_user" };
      }
      log("backend_call.stream_threw", { error: String(err) });
      return { ok: false, drop_reason: "network_drop" };
    }

    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    if (streamError) {
      log("backend_call.error", { message: streamError });
      return { ok: false, drop_reason: "network_drop" };
    }

    if (!envelope) {
      // completed 미수신 = 깨진/빈 응답.
      log("backend_call.parse_error", { event_name: env.event_name });
      return { ok: false, drop_reason: "parse_error" };
    }

    // B5(render half): emotion/motion은 should_speak와 무관하게 적용한다.
    //   firing≠judgment: judgment(should_speak)는 *발화*만 게이팅한다(§7.2/§3).
    try {
      deps.renderer.applyDirective(envelope);
      log("dispatch_to_renderer", {
        emotion: envelope.emotion ?? null,
        motion: envelope.motion ?? null,
      });
    } catch (err) {
      // renderer 에러 → ambient fallback은 renderer 책임, dispatcher는 계속.
      log("dispatch_to_renderer.error", { error: String(err) });
    }

    // B4: should_speak judgment (default true). false면 발화만 silent drop(INFO).
    const shouldSpeak = envelope.should_speak !== false;
    if (!shouldSpeak) {
      log("should_speak_false", { event_name: env.event_name });
      return { ok: true, drop_reason: "should_speak_false" };
    }

    // B5(speech half): speech_text → onSpeech(현재는 dev 로그/콜백, TTS는 #14).
    if (envelope.speech_text) {
      deps.onSpeech?.(envelope.speech_text);
      log("speech", { text: envelope.speech_text });
    }

    return { ok: true };
  }

  return { call };
}
