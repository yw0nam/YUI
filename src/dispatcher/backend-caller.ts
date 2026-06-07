/**
 * Backend caller — B1–B5 호출 시퀀스. (PRD F6 / event-dispatcher.md §7.2)
 *
 * tier2/3 event를 backend judgment로 보낸다. firing≠judgment 경계의 backend 쪽:
 * 말할지/무엇을은 backend가 발화 텍스트 발신 여부로 표현한다(D-NO-SPEAK-GATE: 침묵 = speech_text "").
 *
 *  B1 package_context — contract.md §4 InputContext 조립(user_text + env.timestamp +
 *     env.timezone). active_app/window은 getOsContext 스냅샷이 있을 때만 best-effort로 첨부.
 *  B2 POST — io/chat-client.streamChat(config, req, { fetch, apiKey }). SSE는 chat-client가
 *     소유 — 여기서 직접 파싱하지 않는다. AbortSignal로 in-flight abort(§12).
 *  B3 parse — chat-client의 `completed` 이벤트가 이미 ControlEnvelope를 조립해 준다(§3).
 *     completed 미수신 → parse_error.
 *  B4 speech gate — speech_text가 비어있지 않을 때만 발화(D-NO-SPEAK-GATE). 빈 텍스트 = 침묵,
 *     별도 플래그 없음. emotion/motion은 침묵과 무관하게 렌더.
 *  B5 dispatch_to_renderer — renderer.applyDirective(envelope) + speech_text→onSpeech +
 *     emotion_text→onEmotionText + tool_status→onToolStatus(main.ts에서 TTS/UI로 흘린다).
 *
 * §7.3 silent drop 분류: parse_error(WARN) / network_drop(WARN).
 * 본 MVP는 retry/timeout 정교화(§7.2 B2 retry x1, 5s/30s)는 seam만 두고 단순화한다(#21 spine).
 */

import { streamChat, type ChatRequest } from "../io/chat-client";
import type {
  ControlEnvelope,
  EndpointsConfig,
  InputContext,
  ToolStatus,
} from "../contract";
import type { Renderer } from "../renderer";
import type { BusEnvelope } from "./event-bus";
import type { DropReason } from "./guardrails";
import { createLogger } from "../logger";
import type { Logger } from "../logger";

const baseLog = createLogger("backend_caller");

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
  /** transport fetch 선택(selectFetch). Tauri=cors-fetch, dev=undefined. */
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** 발화 텍스트 sink — main.ts가 말풍선 + TTS 파이프라인(#14)으로 연결한다. delta-less backend용 fallback. */
  onSpeech?: (text: string) => void;
  /** 발화 토큰 증분 sink — speech_delta마다 호출(스트리밍 TTS). main.ts가 말풍선 누적 + 파이프라인 구동으로 연결. */
  onSpeechDelta?: (text: string) => void;
  /** 발화 스트림 종료 sink — 모든 delta 이후 1회. main.ts가 말풍선 dwell 보류 + 파이프라인 flush로 연결. */
  onSpeechEnd?: () => void;
  /** 발화 중단 sink — call() 진입 시 1회. 직전(superseded) 턴의 잔여 오디오/말풍선을 정리한다. */
  onSpeechInterrupt?: () => void;
  /** 토글 ON일 때 화면 캡처 블록을 조립해 반환(OFF/실패면 undefined). main.ts가 settings+capturer+buildScreenshotBlock로 합성. */
  getScreenshot?: () => Promise<InputContext["screenshot"] | undefined>;
  /** 현재 foreground app/title 스냅샷(#18). present 시 env.active_app/active_window_title을 채운다. */
  getOsContext?: () => import("../io/os-context").OsContextSnapshot | undefined;
  /** emotion_text(TTS voice tag) sink — present 시에만 호출. main.ts 배선은 후속(이 PR 비대상). */
  onEmotionText?: (text: string) => void;
  /** tool_status sink — present 시에만 호출. main.ts 배선은 후속(이 PR 비대상). */
  onToolStatus?: (status: ToolStatus) => void;
  /** 구조화 로깅(없으면 backend_caller namespace logger). */
  logger?: Logger;
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
  const log = deps.logger ?? baseLog;

  /**
   * B1: contract §4 InputContext 조립.
   * active_app / active_window_title는 getOsContext 스냅샷이 있을 때만 best-effort로 채운다(없으면 생략).
   * screenshot은 토글 ON일 때만 getScreenshot 포트로 첨부(#20). 캡처 실패는 턴을 깨뜨리지 않는다 — 로그 후 스크린샷 없이 진행.
   */
  async function packageContext(env: BusEnvelope): Promise<InputContext> {
    const userText = userTextOf(env);
    const ctx: InputContext = {
      ...(userText !== undefined ? { user_text: userText } : {}),
      env: {
        timestamp: new Date(env.ts).toISOString(),
        timezone: resolveTimezone(),
      },
      client: { yui_version: deps.yuiVersion ?? "0.0.0" },
    };
    const os = deps.getOsContext?.();
    if (os?.activeApp) ctx.env.active_app = { name: os.activeApp };
    if (os?.activeWindowTitle) ctx.env.active_window_title = os.activeWindowTitle;
    if (deps.getScreenshot) {
      try {
        const screenshot = await deps.getScreenshot();
        if (screenshot) ctx.screenshot = screenshot;
      } catch (err) {
        log.warn("screenshot.failed", { error: String(err) });
      }
    }
    return ctx;
  }

  /** InputContext → OpenAI Responses input (user 발화는 user 메시지로 인코딩). */
  function encodeInput(ctx: InputContext): ChatRequest["input"] {
    const text = ctx.user_text ?? "";
    // 스크린샷 첨부 시 Responses content-part 배열(input_text + input_image), 없으면 평문.
    const userContent = ctx.screenshot?.data_url
      ? [
          { type: "input_text", text },
          { type: "input_image", image_url: ctx.screenshot.data_url },
        ]
      : text;
    // env 메타(시각/타임존)는 system 힌트로 동봉 — backend judgment가 시간 맥락을 쓸 수 있게.
    return [
      {
        role: "system",
        content: `client_context: ${JSON.stringify(ctx.env)}`,
      },
      { role: "user", content: userContent },
    ];
  }

  async function call(
    env: BusEnvelope,
    externalSignal?: AbortSignal,
  ): Promise<BackendCallResult> {
    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    // 직전(superseded) 턴의 잔여 오디오/말풍선을 정리 — 첫 delta보다 먼저 1회.
    deps.onSpeechInterrupt?.();

    // B1
    const ctx = await packageContext(env);
    const input = encodeInput(ctx);
    log.debug("backend_call", { event_name: env.event_name, seq_id: env.seq_id });

    // B2: fetch/apiKey 해소 후 streamChat. externalSignal을 그대로 전달(abort 위임, §12).
    let apiKey: string | undefined;
    let fetchImpl: typeof globalThis.fetch | undefined;
    try {
      [apiKey, fetchImpl] = await Promise.all([deps.getApiKey(), deps.getFetch()]);
    } catch (err) {
      log.warn("network_drop", { stage: "setup", error: String(err) });
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
    // 스트리밍 발화: delta가 1건이라도 왔는가(완료 시 onSpeechEnd 구동 분기).
    let streamedAny = false;
    // emotion_text(voice tag)를 스트림 중 이미 적용했는가(완료 시 중복 방지).
    let emotionTextSent = false;
    try {
      for await (const ev of streamChat(deps.config, request, {
        apiKey,
        fetch: fetchImpl,
      })) {
        switch (ev.type) {
          case "speech_delta":
            deps.onSpeechDelta?.(ev.text);
            streamedAny = true;
            break;
          case "express":
            // voice tag를 스트림 중에 적용 — 이후 문장부터 반영되게.
            if (ev.args.emotion_text != null) {
              deps.onEmotionText?.(ev.args.emotion_text);
              emotionTextSent = true;
            }
            break;
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
      log.warn("network_drop", { stage: "stream_threw", error: String(err) });
      return { ok: false, drop_reason: "network_drop" };
    }

    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    if (streamError) {
      log.warn("network_drop", { stage: "stream_error", message: streamError });
      return { ok: false, drop_reason: "network_drop" };
    }

    if (!envelope) {
      // completed 미수신 = 깨진/빈 응답.
      log.warn("parse_error", { event_name: env.event_name });
      return { ok: false, drop_reason: "parse_error" };
    }

    // B5(render half): emotion/motion은 침묵과 무관하게 적용한다.
    //   firing≠judgment: silence(speech_text "")는 *발화*만 게이팅한다(§7.2/§3).
    try {
      deps.renderer.applyDirective(envelope);
      log.debug("dispatch_to_renderer", {
        emotion: envelope.emotion ?? null,
        motion: envelope.motion ?? null,
      });
    } catch (err) {
      // renderer 에러 → ambient fallback은 renderer 책임, dispatcher는 계속.
      log.error("dispatch_to_renderer.error", { error: String(err) });
    }

    // B5(emotion_text half): TTS voice tag → onEmotionText.
    //   스트림 중 express로 이미 적용했으면 중복 호출 X. delta/express 없는 completed-only
    //   응답은 여기서 1회 적용해 기존 동작을 보존한다.
    if (!emotionTextSent && envelope.emotion_text != null) {
      deps.onEmotionText?.(envelope.emotion_text);
    }

    // B5(tool_status half): 네이티브 tool 관찰 결과 → onToolStatus(있을 때만).
    if (envelope.tool_status != null) {
      deps.onToolStatus?.(envelope.tool_status);
    }

    // B4(speech gate, D-NO-SPEAK-GATE): speech_text가 비어있지 않을 때만 발화.
    //   빈 텍스트 = 침묵 — 별도 플래그/판정 없음, drop_reason도 없음.
    if (streamedAny) {
      // 스트리밍 경로: delta로 이미 발화를 구동했으니 종료만 알린다(onSpeech 호출 X).
      deps.onSpeechEnd?.();
      log.debug("speech", { text: envelope.speech_text });
    } else if (envelope.speech_text) {
      // legacy fallback: delta 없이 completed만 주는 backend.
      deps.onSpeech?.(envelope.speech_text);
      log.debug("speech", { text: envelope.speech_text });
    } else {
      log.info("empty_speech", { trigger: env.event_name });
    }

    return { ok: true };
  }

  return { call };
}
