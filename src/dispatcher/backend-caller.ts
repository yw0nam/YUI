/**
 * Backend caller — B1–B5 호출 시퀀스.
 *
 * tier2/3 event를 backend judgment로 보낸다. firing≠judgment 경계의 backend 쪽:
 * 발화 여부는 speech_text가 비어있는지로만 결정한다(별도 플래그 없음: 침묵 = speech_text "").
 *
 *  B1 package_context — InputContext 조립(user_text + env.timestamp +
 *     env.timezone). active_app/window은 getOsContext 스냅샷이 있을 때만 best-effort로 첨부.
 *  B2 POST — io/chat-client.streamChat(config, req, { fetch, apiKey }). SSE는 chat-client가
 *     소유 — 여기서 직접 파싱하지 않는다. AbortSignal로 in-flight abort.
 *  B3 parse — chat-client의 `completed` 이벤트가 이미 ControlEnvelope를 조립해 준다.
 *     completed 미수신 → parse_error.
 *  B4 speech gate — speech_text가 비어있지 않을 때만 발화. 빈 텍스트 = 침묵,
 *     별도 플래그 없음. emotion/motion은 침묵과 무관하게 렌더.
 *  B5 dispatch_to_renderer — per-beat cue가 스트리밍되면 TTS 파이프라인이 audio-timed로
 *     emotion/motion을 적용(express→onCue)하고, 그 외엔 completed에서 renderer.applyDirective(envelope).
 *     speech_text→onSpeech + tool_status→onToolStatus(main.ts에서 TTS/UI로 흘린다).
 *
 * silent drop 분류: parse_error(WARN) / network_drop(WARN).
 */

import type {
  ClientContext,
  ControlEnvelope,
  EndpointsConfig,
  ExpressArgs,
  InputContext,
  ToolStatus,
  Usage,
} from "../contract";
import { type ChatRequest, streamChat } from "../io/chat-client";
import type { Logger } from "../logger";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import type { BusEnvelope } from "./event-bus";
import type { DropReason } from "./guardrails";

const baseLog = createLogger("backend-caller");

/** proactive/schedule 턴(user_text 없음)의 user 메시지 마커 — 빈 문자열 대신 명시적 신호. */
const PROACTIVE_MARKER = "(proactive trigger)";

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
  /** per-beat cue sink — 매 express cue를 그대로 흘린다(emotion_id/motion_id/emotion_text). main.ts에서 TTS 파이프라인(speechPlayback.setCue)에 배선 — 문장 재생 시점에 audio-timed 적용. */
  onCue?: (cue: ExpressArgs) => void;
  /** tool_status sink — present 시에만 호출. */
  onToolStatus?: (status: ToolStatus) => void;
  /** 직전 response id 조회 — present 시 요청에 실어 대화를 잇는다. 매 턴 호출(reset/rotation 반영). */
  getPreviousResponseId?: () => string | undefined;
  /** 새 response id persist — 완전히 성공한 턴 이후에만 호출(대화 상태 진행). */
  onResponseId?: (id: string) => void;
  /** usage(토큰 점유량) sink — present 시에만 호출. ControlEnvelope와 무관한 진단 채널. */
  onUsage?: (usage: Usage) => void;
  /** 현재 agent 설정(추론 강도 + instructions 오버라이드) 스냅샷. present일 때만 요청에 반영. */
  getAgentSettings?: () => import("../io/agent-settings").AgentSettings;
  /** TTFT thinking 진입 sink — filler 활성 시 call() 진입에서 동기로 1회. token은 이 call() 고유. main.ts가 thinking 모션 + 필러 발화 루프로 연결. */
  onThinkingStart?: (token: object) => void;
  /** TTFT thinking 종료 sink — 첫 speech_delta(실제 응답 발화 시작) / 턴 종료(어느 경로든) 시 1회. start와 동일 token. main.ts가 cross-turn supersede를 token으로 가린다. */
  onThinkingEnd?: (token: object) => void;
  /** filler 활성 여부 조회 — filler 켜짐 + 풀 non-empty면 true. true일 때만 thinking을 동기로 시작한다(매 턴 호출). */
  getFiller?: () => boolean;
  /** 구조화 로깅(없으면 backend_caller namespace logger). */
  logger?: Logger;
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

/** payload에서 첨부 이미지(data URLs) 추출 — 모든 원소가 string인 배열일 때만. */
function userImagesOf(env: BusEnvelope): string[] | undefined {
  const imgs = env.payload?.images;
  return Array.isArray(imgs) && imgs.every((u) => typeof u === "string")
    ? (imgs as string[])
    : undefined;
}

/** 안전한 timezone 조회(환경에 따라 throw 가능 → fallback). */
function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Local ISO 8601 wall-clock string with timezone offset (e.g. "2026-06-15T09:00:12+09:00").
 * Falls back to UTC toISOString() if formatting throws.
 */
function localIso(ts: number, timeZone: string): string {
  const d = new Date(ts);
  try {
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(d)
      .replace(" ", "T");

    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value;
    const offset =
      name && name !== "GMT" && name !== "UTC" ? name.replace(/^(?:GMT|UTC)/, "") : "+00:00";

    return `${local}${offset}`;
  } catch {
    return d.toISOString();
  }
}

export function createBackendCaller(deps: BackendCallerDeps): BackendCaller {
  const log = deps.logger ?? baseLog;

  /**
   * B1: InputContext 조립.
   * active_app / active_window_title는 getOsContext 스냅샷이 있을 때만 best-effort로 채운다(없으면 생략).
   * screenshot은 토글 ON일 때만 getScreenshot 포트로 첨부. 캡처 실패는 턴을 깨뜨리지 않는다 — 로그 후 스크린샷 없이 진행.
   * user_text는 encodeInput에서 user 메시지에만 실린다 — system context에는 포함되지 않는다.
   */
  async function packageContext(env: BusEnvelope): Promise<InputContext> {
    const userText = userTextOf(env);
    const userImages = userImagesOf(env);
    const tz = resolveTimezone();
    const ctx: InputContext = {
      ...(userText !== undefined ? { user_text: userText } : {}),
      ...(userImages?.length ? { user_images: userImages } : {}),
      env: {
        timestamp: localIso(env.ts, tz),
        timezone: tz,
      },
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

  /**
   * InputContext → OpenAI Responses input (user 발화는 user 메시지로만 인코딩).
   *
   * System message carries the flat ClientContext:
   *   { env, screenshot?, trigger }
   *   - env: timestamp/timezone + optional active_app/active_window_title (no user utterance).
   *   - screenshot: meta only (enabled/source/captured_at/width/height) — data_url is stripped
   *     and sent as the user input_image content-part instead.
   *   - trigger: { kind, cue?, idle_elapsed_min? }
   *     kind: derived from event_name ("schedule.*"→"schedule", "proactive.*"→"proactive", else "user").
   *     cue: present when payload has cue_id+label+context — carries label/context/local_time?/idle_min?,
   *          id is omitted from the wire shape.
   *     idle_elapsed_min: Math.round(gap_ms/60000) when gap_ms is present (proactive turns).
   *
   * User message: userText ?? PROACTIVE_MARKER (+ image content-part when screenshot present).
   * User text is NEVER serialized into the system ClientContext.
   */
  function encodeInput(ctx: InputContext, env: BusEnvelope): ChatRequest["input"] {
    const text = ctx.user_text ?? PROACTIVE_MARKER;
    // 이미지(스크린샷 또는 첨부)가 하나라도 있으면 Responses content-part 배열, 없으면 평문.
    // 스크린샷 part가 먼저, 그다음 사용자 첨부 이미지들.
    const hasImage = !!ctx.screenshot?.data_url || !!ctx.user_images?.length;
    const userContent = hasImage
      ? [
          { type: "input_text", text },
          ...(ctx.screenshot?.data_url
            ? [{ type: "input_image", image_url: ctx.screenshot.data_url }]
            : []),
          ...(ctx.user_images ?? []).map((image_url) => ({ type: "input_image", image_url })),
        ]
      : text;

    // derive trigger.kind from event_name
    const eventName = env.event_name;
    const kind = eventName.startsWith("schedule.")
      ? "schedule"
      : eventName.startsWith("proactive.")
        ? "proactive"
        : "user";

    // cue: present when payload carries cue_id+label+context; id is omitted from wire shape.
    const p = env.payload;
    const cue =
      typeof p?.cue_id === "string" &&
      typeof p?.label === "string" &&
      typeof p?.context === "string"
        ? {
            label: p.label as string,
            context: p.context as string,
            ...(typeof p.local_time === "string" ? { local_time: p.local_time as string } : {}),
            ...(typeof p.idle_min === "number" ? { idle_min: p.idle_min as number } : {}),
          }
        : undefined;

    // idle_elapsed_min: proactive only, derived from gap_ms.
    const gap_ms = typeof p?.gap_ms === "number" ? (p.gap_ms as number) : undefined;

    // screenshot meta only (data_url stripped — rides the user image content-part above).
    const screenshotMeta: ClientContext["screenshot"] = ctx.screenshot
      ? (() => {
          const { data_url: _omit, ...meta } = ctx.screenshot;
          return meta;
        })()
      : undefined;

    const clientContext: ClientContext = {
      env: ctx.env,
      ...(screenshotMeta ? { screenshot: screenshotMeta } : {}),
      trigger: {
        kind,
        ...(cue ? { cue } : {}),
        ...(gap_ms != null ? { idle_elapsed_min: Math.round(gap_ms / 60000) } : {}),
      },
    };

    return [
      {
        role: "system",
        content: `client_context: ${JSON.stringify(clientContext)}`,
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

    // TTFT thinking — filler 활성 시 call() 진입에서 즉시 시작(judgment 아님, 첫 줄은 지연 없음).
    // 종료는 실제 응답 발화(첫 speech_delta) 시작 시 1회 — 그 전의 usage/express/tool_status는
    // thinking을 깨뜨리지 않는다. 침묵/에러/abort 턴은 finally가 종료를 보장한다.
    // call()은 턴이 겹칠 수 있어 상태를 per-invocation local로 둔다(절대 closure/module scope 금지).
    // turnToken: 이 call() 고유 identity — start/end에 같은 token을 실어 main.ts가
    // cross-turn supersede(겹친 다음 턴이 이 턴을 추월)에서 stale end를 token으로 가린다.
    const turnToken = {};
    let thinkingStarted = false;
    let thinkingDone = false;
    const startThinking = () => {
      if (thinkingStarted || thinkingDone) return;
      thinkingStarted = true;
      deps.onThinkingStart?.(turnToken);
    };
    const endThinking = () => {
      if (thinkingDone) return;
      thinkingDone = true;
      if (thinkingStarted) deps.onThinkingEnd?.(turnToken);
    };

    // 전 구간을 try/finally로 감싼다 — 어느 종료 경로든 thinking 종료가 정확히 1회 보장된다
    // (setup reject, early abort, stream throw, post-loop abort, streamError, empty/parse_error,
    // 정상 완료 전부).
    try {
      // filler 활성이면 첫 줄을 지연 없이 띄운다(동기 시작). disabled/빈 풀이면 시작하지 않는다.
      if (deps.getFiller?.()) startThinking();

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

      // 직전 response id를 스냅샷해 요청에 싣는다 — 완료 시 reset 감지(R2)를 위해 시작값을 보존.
      const startPreviousResponseId = deps.getPreviousResponseId?.();
      if (startPreviousResponseId) request.previous_response_id = startPreviousResponseId;

      // agent 설정 반영: reasoning_effort는 항상 전송, 빈 instructions는 config 폴백을 위해 생략.
      const agent = deps.getAgentSettings?.();
      if (agent) {
        request.reasoning_effort = agent.reasoning_effort;
        if (agent.instructions.trim()) request.instructions = agent.instructions;
      }

      // B3: chat-client의 completed 이벤트에서 ControlEnvelope 수령(SSE 재파싱 X).
      let envelope: ControlEnvelope | undefined;
      let newResponseId: string | undefined;
      let streamError: string | undefined;
      // 스트리밍 발화: delta가 1건이라도 왔는가(완료 시 onSpeechEnd 구동 분기).
      let streamedAny = false;
      // express cue가 스트림 중 1건이라도 왔는가(완료 시 pipeline 소유 분기).
      let cueStreamed = false;
      try {
        for await (const ev of streamChat(deps.config, request, {
          apiKey,
          fetch: fetchImpl,
        })) {
          switch (ev.type) {
            case "speech_delta":
              // 실제 응답 발화 시작 — 여기서만 thinking 종료(thinkingDone로 첫 delta에서만 발화).
              // 그 전의 usage/express/tool_status는 thinking을 깨뜨리지 않는다.
              endThinking();
              deps.onSpeechDelta?.(ev.text);
              streamedAny = true;
              break;
            case "express":
              // 전체 cue를 그대로 흘린다 — TTS 파이프라인이 문장 재생 시점에 audio-timed 적용.
              deps.onCue?.(ev.args);
              cueStreamed = true;
              break;
            case "usage":
              // ControlEnvelope/renderer와 무관한 진단 채널 — sink로만 흘린다.
              deps.onUsage?.(ev.usage);
              break;
            case "completed":
              envelope = ev.envelope;
              newResponseId = ev.responseId || undefined;
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

      // B5(render half): per-beat cue가 스트리밍됐고 발화가 있으면(streamedAny) TTS 파이프라인이
      //   문장 재생 시점에 cue를 audio-timed 적용한다 — 여기서 중복 적용하지 않는다.
      //   그 외(cue 없음, 또는 cue는 있으나 침묵 턴)는 completed에서 1회 적용:
      //   firing≠judgment — silent-turn-with-cue도 emotion/motion을 렌더하고,
      //   express를 스트리밍하지 않는 completed-only backend도 보존한다.
      const pipelineOwnsCues = cueStreamed && streamedAny;
      if (pipelineOwnsCues) {
        log.debug("dispatch_to_renderer", {
          owner: "pipeline",
          emotion: envelope.emotion ?? null,
          motion: envelope.motion ?? null,
        });
      } else {
        try {
          deps.renderer.applyDirective(envelope);
          log.debug("dispatch_to_renderer", {
            owner: "completed",
            emotion: envelope.emotion ?? null,
            motion: envelope.motion ?? null,
          });
        } catch (err) {
          // renderer 에러 → ambient fallback은 renderer 책임, dispatcher는 계속.
          log.error("dispatch_to_renderer.error", { error: String(err) });
        }
      }

      // B5(tool_status half): 네이티브 tool 관찰 결과 → onToolStatus(있을 때만).
      if (envelope.tool_status != null) {
        deps.onToolStatus?.(envelope.tool_status);
      }

      // B4(speech gate): speech_text가 비어있지 않을 때만 발화.
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

      // 대화 상태 진행: post-stream 가드(abort / streamError / !envelope)를 모두 통과한 이 지점에서만
      // persist. 시작 시점 id가 그대로일 때만 — in-flight 중 reset/rotation(R2)이 있었다면 그 새 상태를
      // 죽은 응답으로 되살리지 않는다.
      if (newResponseId && deps.getPreviousResponseId?.() === startPreviousResponseId) {
        deps.onResponseId?.(newResponseId);
      }

      return { ok: true };
    } finally {
      endThinking();
    }
  }

  return { call };
}
