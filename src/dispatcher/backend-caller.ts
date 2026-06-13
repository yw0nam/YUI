/**
 * Backend caller — B1–B5 호출 시퀀스.
 *
 * tier2/3 event를 backend judgment로 보낸다. firing≠judgment 경계의 backend 쪽:
 * 말할지/무엇을은 backend가 발화 텍스트 발신 여부로 표현한다(should_speak 플래그 없음: 침묵 = speech_text "").
 *
 *  B1 package_context — InputContext 조립(user_text + env.timestamp +
 *     env.timezone). active_app/window은 getOsContext 스냅샷이 있을 때만 best-effort로 첨부.
 *  B2 POST — io/chat-client.streamChat(config, req, { fetch, apiKey }). SSE는 chat-client가
 *     소유 — 여기서 직접 파싱하지 않는다. AbortSignal로 in-flight abort.
 *  B3 parse — chat-client의 `completed` 이벤트가 이미 ControlEnvelope를 조립해 준다.
 *     completed 미수신 → parse_error.
 *  B4 speech gate — speech_text가 비어있지 않을 때만 발화(should_speak 플래그 없음). 빈 텍스트 = 침묵,
 *     별도 플래그 없음. emotion/motion은 침묵과 무관하게 렌더.
 *  B5 dispatch_to_renderer — renderer.applyDirective(envelope) + speech_text→onSpeech +
 *     emotion_text→onEmotionText + tool_status→onToolStatus(main.ts에서 TTS/UI로 흘린다).
 *
 * silent drop 분류: parse_error(WARN) / network_drop(WARN).
 */

import type {
  ControlEnvelope,
  DispatcherStateMeta,
  EndpointsConfig,
  InputContext,
  ToolStatus,
  TriggerMeta,
  Usage,
} from "../contract";
import { type ChatRequest, streamChat } from "../io/chat-client";
import type { Logger } from "../logger";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import type { BusEnvelope } from "./event-bus";
import type { DropReason } from "./guardrails";

const baseLog = createLogger("backend-caller");

/** proactive 턴(user_text 없음)의 user 메시지 마커 — 빈 문자열 대신 명시적 신호. */
const PROACTIVE_MARKER = "(proactive: co-working check-in)";

/** Dispatcher → Backend Caller 출력: { ok, drop_reason? }. */
export interface BackendCallResult {
  ok: boolean;
  drop_reason?: DropReason;
}

export interface BackendCallerDeps {
  /** chat endpoint config. */
  config: EndpointsConfig;
  /** render directive sink (applyDirective). */
  renderer: Pick<Renderer, "applyDirective">;
  /** Hermes 인증 키 해소(SecretProvider). 없으면 무인증 placeholder. */
  getApiKey: () => Promise<string | undefined>;
  /** transport fetch 선택(selectFetch). Tauri=cors-fetch, dev=undefined. */
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** 발화 텍스트 sink — main.ts가 말풍선 + TTS 파이프라인으로 연결한다. delta-less backend용 fallback. */
  onSpeech?: (text: string) => void;
  /** 발화 토큰 증분 sink — speech_delta마다 호출(스트리밍 TTS). main.ts가 말풍선 누적 + 파이프라인 구동으로 연결. */
  onSpeechDelta?: (text: string) => void;
  /** 발화 스트림 종료 sink — 모든 delta 이후 1회. main.ts가 말풍선 dwell 보류 + 파이프라인 flush로 연결. */
  onSpeechEnd?: () => void;
  /** 발화 중단 sink — call() 진입 시 1회. 직전(superseded) 턴의 잔여 오디오/말풍선을 정리한다. */
  onSpeechInterrupt?: () => void;
  /** 발화 비정상 종료 sink — 스트림 중 에러/끊김(유저 supersede 아님)으로 끝났고 delta가 1건 이상 왔을 때. 말풍선/오디오를 정리한다. */
  onSpeechAbort?: () => void;
  /** 토글 ON일 때 화면 캡처 블록을 조립해 반환(OFF/실패면 undefined). main.ts가 settings+capturer+buildScreenshotBlock로 합성. */
  getScreenshot?: () => Promise<InputContext["screenshot"] | undefined>;
  /** 현재 foreground app/title 스냅샷. present 시 env.active_app/active_window_title을 채운다. */
  getOsContext?: () => import("../io/os-context").OsContextSnapshot | undefined;
  /** emotion_text(TTS voice tag) sink — present 시에만 호출. main.ts에서 TTS 파이프라인(speechPlayback.setEmotionText)에 배선됨. */
  onEmotionText?: (text: string) => void;
  /** tool_status sink — present 시에만 호출. */
  onToolStatus?: (status: ToolStatus) => void;
  /** 현재 Hermes session id 조회 — present 시 X-Hermes-Session-Id 헤더로 흘린다. 매 턴 호출(rotation 반영). */
  getSessionId?: () => string | undefined;
  /** usage(토큰 점유량) sink — present 시에만 호출. ControlEnvelope와 무관한 진단 채널. */
  onUsage?: (usage: Usage) => void;
  /** 현재 agent 설정(추론 강도 + instructions 오버라이드) 스냅샷. present일 때만 요청에 반영. */
  getAgentSettings?: () => import("../io/agent-settings").AgentSettings;
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
   * B1: InputContext 조립.
   * active_app / active_window_title는 getOsContext 스냅샷이 있을 때만 best-effort로 채운다(없으면 생략).
   * screenshot은 토글 ON일 때만 getScreenshot 포트로 첨부. 캡처 실패는 턴을 깨뜨리지 않는다 — 로그 후 스크린샷 없이 진행.
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
    if (os?.isFullscreen !== undefined) ctx.env.is_fullscreen = os.isFullscreen;
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

  /**
   * InputContext → OpenAI Responses input (user 발화는 user 메시지로 인코딩).
   *
   * system 힌트는 layered shape `{ input_context, trigger, dispatcher_state }`.
   *   - input_context: InputContext에서 screenshot.data_url을 뺀 사본(큰 base64는 USER
   *     content-part로만 싣는다 — 힌트엔 cheap한 screenshot meta만 남긴다).
   *   - trigger: firing envelope 메타(source/event_name/ts, seq_id present 시).
   *   - dispatcher_state: dispatcher가 아는 부가 상태(idle_seconds/tier_hint). dnd_state는 미설정.
   * proactive 턴(user_text 없음)은 빈 문자열 대신 non-empty 마커를 user 메시지로 싣는다.
   */
  function encodeInput(ctx: InputContext, env: BusEnvelope): ChatRequest["input"] {
    const text = ctx.user_text ?? PROACTIVE_MARKER;
    // 스크린샷 첨부 시 Responses content-part 배열(input_text + input_image), 없으면 평문.
    const userContent = ctx.screenshot?.data_url
      ? [
          { type: "input_text", text },
          { type: "input_image", image_url: ctx.screenshot.data_url },
        ]
      : text;

    // 큰 data_url은 힌트에서 제거(USER content-part로만 전송). 나머지 screenshot meta는 보존.
    const input_context: InputContext = ctx.screenshot
      ? (() => {
          const { data_url: _omit, ...meta } = ctx.screenshot;
          return { ...ctx, screenshot: meta };
        })()
      : ctx;

    const trigger: TriggerMeta = {
      source: env.source,
      event_name: env.event_name,
      ts: env.ts,
      ...(env.seq_id != null ? { seq_id: env.seq_id } : {}),
    };

    const os_idle_ms =
      typeof env.payload?.os_idle_ms === "number" ? env.payload.os_idle_ms : undefined;
    const dispatcher_state: DispatcherStateMeta = {
      ...(os_idle_ms != null ? { idle_seconds: Math.round(os_idle_ms / 1000) } : {}),
      ...(env.hint_tier != null ? { tier_hint: env.hint_tier } : {}),
    };

    return [
      {
        role: "system",
        content: `client_context: ${JSON.stringify({ input_context, trigger, dispatcher_state })}`,
      },
      { role: "user", content: userContent },
    ];
  }

  async function call(env: BusEnvelope, externalSignal?: AbortSignal): Promise<BackendCallResult> {
    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    // 직전(superseded) 턴의 잔여 오디오/말풍선을 정리 — 첫 delta보다 먼저 1회.
    deps.onSpeechInterrupt?.();

    // B1
    const ctx = await packageContext(env);
    const input = encodeInput(ctx, env);
    log.debug("backend_call", { event_name: env.event_name, seq_id: env.seq_id });

    // B2: fetch/apiKey 해소 후 streamChat. externalSignal을 그대로 전달(abort 위임).
    let apiKey: string | undefined;
    let fetchImpl: typeof globalThis.fetch | undefined;
    try {
      [apiKey, fetchImpl] = await Promise.all([deps.getApiKey(), deps.getFetch()]);
    } catch (err) {
      log.warn("network_drop", { stage: "setup", error: String(err) });
      return { ok: false, drop_reason: "network_drop" };
    }

    // 매 턴 현재 session id를 읽는다(생성 시점 캐시 X) — 턴 사이 rotation을 반영.
    const sessionId = deps.getSessionId?.();

    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    // in-flight fetch는 AbortController로 정리한다. 외부 signal(dispatcher의
    // supersede abort)을 내부 컨트롤러에 링크해 항상 단일 signal을 streamChat에 넘긴다.
    const ac = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) ac.abort();
      else externalSignal.addEventListener("abort", () => ac.abort(), { once: true });
    }
    const request: ChatRequest = { input, signal: ac.signal };

    // agent 설정 반영: "default"는 생략, 빈 instructions는 config 폴백을 위해 생략.
    const agent = deps.getAgentSettings?.();
    if (agent) {
      if (agent.reasoning_effort !== "default") request.reasoning_effort = agent.reasoning_effort;
      if (agent.instructions.trim()) request.instructions = agent.instructions;
    }

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
        sessionId,
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
          case "usage":
            // ControlEnvelope/renderer와 무관한 진단 채널 — sink로만 흘린다.
            deps.onUsage?.(ev.usage);
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
      // abort면 supersede(다음 턴이 정리), 그 외는 network drop — delta가 떴으면 말풍선/오디오 정리.
      if (externalSignal?.aborted) {
        return { ok: false, drop_reason: "superseded_by_user" };
      }
      if (streamedAny) deps.onSpeechAbort?.();
      log.warn("network_drop", { stage: "stream_threw", error: String(err) });
      return { ok: false, drop_reason: "network_drop" };
    }

    if (externalSignal?.aborted) {
      return { ok: false, drop_reason: "superseded_by_user" };
    }

    if (streamError) {
      // delta가 떴으면 말풍선/오디오 정리 — 다음 턴이 없어 영영 갇히지 않게.
      if (streamedAny) deps.onSpeechAbort?.();
      log.warn("network_drop", { stage: "stream_error", message: streamError });
      return { ok: false, drop_reason: "network_drop" };
    }

    if (!envelope) {
      // completed 미수신 = 깨진/빈 응답.
      log.warn("parse_error", { event_name: env.event_name });
      return { ok: false, drop_reason: "parse_error" };
    }

    // B5(render half): emotion/motion은 침묵과 무관하게 적용한다.
    //   firing≠judgment: silence(speech_text "")는 *발화*만 게이팅한다.
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

    // B4(speech gate, should_speak 플래그 없음): speech_text가 비어있지 않을 때만 발화.
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
