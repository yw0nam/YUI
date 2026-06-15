/**
 * YUI ↔ Hermes contract — TypeScript types. 이 타입이 wire 스키마의 source of truth다.
 *
 * 전송 규약 요지:
 *  - 제어신호(emotion_id/motion_id/emotion_text)는 서버사이드 `generate_express` tool-call의
 *    arguments로 도착 (flat 문자열 인자).
 *  - 발화 텍스트는 tool-call이 아니라 별도 assistant 텍스트 스트림(response.output_text.delta).
 *  - generate_express·emotion은 둘 다 optional — 없는 턴은 idle + 직전 표정 유지.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Emotion Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * backend가 turn마다 보낼 수 있는 emotion enum.
 * 표준 6종은 VRM 1.0 preset 그대로, 확장 4종은 fallback 체인으로 매핑.
 */
export type EmotionId =
  | "neutral"
  | "happy"
  | "angry"
  | "sad"
  | "relaxed"
  | "surprised"
  | "thinking"
  | "curious"
  | "sleepy"
  | "embarrassed";

export interface EmotionSignal {
  id: EmotionId;
  /** 0.0~1.0, default 1.0. 범위 밖이면 client가 클램프 + 경고. */
  intensity?: number;
  /** 보간 시간(ms), default 250. */
  transition_ms?: number;
}

/**
 * configs/emotion_registry.json 한 항목.
 * emotion enum → VRM expression 키 + fallback 체인. 최종 fallback은 항상 "neutral".
 */
export interface EmotionRegistryEntry {
  /** VRM expression 키 (표준 preset 키 또는 모델 커스텀 키). */
  vrm_expression: string;
  /** 해당 expression이 없을 때 폴백할 emotion id 또는 expression 키. */
  fallback: string;
}

export type EmotionRegistry = Partial<Record<EmotionId, EmotionRegistryEntry>>;

// ─────────────────────────────────────────────────────────────────────────────
// Motion Registry
// ─────────────────────────────────────────────────────────────────────────────

export type MotionKind = "ambient" | "reactive" | "state" | "oneshot";
export type InterruptPolicy = "replace" | "queue" | "ignore";

export interface MotionSignal {
  /** registry key. */
  id: string;
  /** registry default 오버라이드. */
  loop?: boolean;
  /** 0.25~2.5, default 1.0. */
  speed?: number;
  /** crossfade(ms), default 200. */
  fade_ms?: number;
}

/**
 * configs/motions.json 한 항목. registry가 priority/interrupt의 진실의 원천 —
 * backend는 ID 문자열만 알면 된다.
 */
export interface MotionRegistryEntry {
  /** VRMA 파일 경로 (Vite public → "/motions/<id>.vrma"). variants 사용 시 기본/대표 경로(=variants[0]). */
  vrma_path: string;
  /** 2개 이상의 VRMA 풀. 있으면 클라이언트가 entry마다 한 개를 골라 재생(variant_policy). 없으면 vrma_path 단일 사용. */
  variants?: string[];
  /** variants가 있을 때 선택 정책. default "random". */
  variant_policy?: "random" | "sequential";
  /** cycle 모션이 다음 variant로 swap하기 전 마지막(정착) 프레임을 유지할 ms. 없으면/0이면 즉시 swap. variants>1 + loop 필요. */
  cycle_dwell_ms?: number;
  /** entry-level default crossfade ms — signal이 fade_ms를 생략할 때 쓰인다. 없으면 200으로 폴백. */
  fade_ms?: number;
  /** false면 broker(agent) 어휘에서 제외 — 로컬 렌더만. default true. */
  broker_publish?: boolean;
  kind: MotionKind;
  loop: boolean;
  /** 0~100, 높을수록 우선. */
  priority: number;
  interrupt_policy: InterruptPolicy;
}

export type MotionRegistry = Record<string, MotionRegistryEntry>;

// ─────────────────────────────────────────────────────────────────────────────
// Control Signal Envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `generate_express` tool-call의 arguments = transport 페이로드.
 * FLAT 문자열 인자 — 이것만이 실제로 wire를 타는 제어 필드다. 전부 optional이며
 * generate_express 없는 턴은 비어 있다.
 * 침묵은 speech_text가 빈 문자열인 것으로 표현한다.
 */
export interface ExpressArgs {
  /** emotion enum id. 없으면 직전 표정 유지. client가 EmotionSignal{id}로 정규화. */
  emotion_id?: string;
  /** motion registry key. 없으면 client가 emotion에서 파생. MotionSignal{id}로 정규화. */
  motion_id?: string;
  /** TTS voice tag(예: "[whisper in small voice]") — 자유 텍스트. emotion_text 채널로 정규화. */
  emotion_text?: string;
}

/** rich_content 항목. 텍스트 마크다운으로 렌더. */
export type RichItem =
  | { kind: "image"; url: string; alt?: string }
  | { kind: "link"; url: string; title: string; desc?: string }
  | {
      kind: "card";
      title: string;
      body?: string;
      image?: string;
      action?: Record<string, unknown>;
    };

/** Responses `response.completed` 이벤트의 usage — 현재 세션 토큰 점유량 추적 입력. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * `POST /api/sessions/{id}/compress` 응답 (status 판별 union). session_id는 공통,
 * compressed는 토큰/메시지/removed/previous_session_id를, skipped는 reason을 노출한다.
 * 서버가 추가 필드를 보낼 수 있으므로 관대하게 받는다.
 */
export type SessionCompressionResponse =
  | {
      object: "hermes.session.compression";
      status: "compressed";
      session_id: string;
      previous_session_id: string;
      before_messages: number;
      after_messages: number;
      before_tokens: number;
      after_tokens: number;
      removed: number;
      [extra: string]: unknown;
    }
  | {
      object: "hermes.session.compression";
      status: "skipped";
      session_id: string;
      reason: string;
      [extra: string]: unknown;
    };

/** Hermes 네이티브 tool의 function_call item을 client가 관찰해 도출 (express 아님). */
export interface ToolStatus {
  state: "idle" | "running" | "done" | "error";
  /** function_call name 기반 라벨. ex: "검색 중…". */
  label?: string;
  /** function_call name. */
  tool_id?: string;
}

/**
 * client 내부 정규화 형태. express arguments + 텍스트 스트림 + 네이티브
 * function_call 관찰을 합친 render directive 입력. wire 스키마가 아니라 client가 재구성하는 형태.
 */
export interface ControlEnvelope {
  // --- generate_express tool-call arguments (있을 때만) ---
  // 침묵은 speech_text가 빈 문자열인 것으로 표현한다.
  emotion?: EmotionSignal | null;
  motion?: MotionSignal | null;
  /** generate_express.emotion_text — TTS voice tag 자유 텍스트. backend-caller가 onCue로 라우팅, tts-pipeline이 문장 합성에 prefix. */
  emotion_text?: string | null;

  // --- 텍스트 스트림에서 조립 (tool 필드 아님) ---
  /** response.output_text.delta 누적. 발화 없으면 "". */
  speech_text: string;

  // --- Hermes 네이티브 tool function_call item 관찰로 도출 ---
  tool_status?: ToolStatus | null;

  /** 발화 텍스트의 마크다운으로 인라인 렌더. */
  rich_content?: RichItem[];

  /** v0에서 전부 무시. */
  _reserved?: {
    expression_frames?: unknown[];
    visemes?: unknown[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Context Schema (client → backend)
// ─────────────────────────────────────────────────────────────────────────────

/** 캡처 소스. 사용자가 monitor / browser tab / window 중 선택. */
export type ScreenSource =
  | { kind: "monitor"; index: number; label?: string }
  | { kind: "browser_tab"; browser: string; tab_title: string; url?: string }
  | { kind: "window"; app: string; window_title: string };

export interface InputContext {
  /** 키보드 입력. */
  user_text?: string;
  /** STT 결과. */
  transcript?: { text: string; confidence?: number; lang?: string };

  env: {
    /** ISO 8601. */
    timestamp: string;
    /** ex: "Asia/Seoul". client가 항상 채운다. */
    timezone: string;
    active_app?: { name: string; bundle_id?: string };
    active_window_title?: string;
    /** OS fullscreen 상태(genuine OS state). */
    is_fullscreen?: boolean;
    locale?: string;
  };

  screenshot?: {
    /** 토글 상태 자체를 명시. */
    enabled: boolean;
    source: ScreenSource;
    /** "data:image/png;base64,..." or "https://...". */
    data_url?: string;
    captured_at?: string;
    width?: number;
    height?: number;
  };

  client: { yui_version: string; persona_hint?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher-layer metadata
// dispatcher가 backend 호출 시 input_context 위에 wire에서 덧싣는 메타데이터.
// InputContext 안이 아니라 그 위에 layered.
// ─────────────────────────────────────────────────────────────────────────────

/** firing trigger envelope — 어떤 source의 어떤 event가 이 backend 턴을 발사했는지. */
export interface TriggerMeta {
  source: string;
  event_name: string;
  ts: number;
  seq_id?: number;
}

/** dispatcher가 알고 있는 부가 상태(InputContext에는 없음). */
export interface DispatcherStateMeta {
  idle_seconds?: number;
  dnd_state?: "OFF" | "ON";
  tier_hint?: 1 | 2 | 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint config
// ─────────────────────────────────────────────────────────────────────────────

/** configs/endpoints.json. chat/stt/tts 세 base URL은 서로 다른 프로세스. */
export interface EndpointsConfig {
  /**
   * Hermes API root (SSH 터널, 예: `http://localhost:8643/v1`). openai SDK가 이 뒤에 `/responses`를
   * 자체 append하므로 `/v1`까지 포함한 root다(streamChat은 이 값만 baseURL로 쓴다).
   */
  chat_base_url: string;
  /**
   * 정보용/비-SDK 폴백 경로. default "/v1/responses", fallback "/v1/chat/completions".
   * ⚠ SDK 경로(streamChat)는 이 필드를 쓰지 않는다 — chat_base_url + SDK append로 결정.
   *   `chat_base_url + chat_endpoint`로 합치지 말 것(이미 `/v1` 중복).
   */
  chat_endpoint: string;
  /**
   * Responses API `instructions` 필드로 보낼 시스템 nudge (config-driven, 하드코딩 금지).
   * generate_express tool 사용을 유도한다(emotion_id/motion_id/emotion_text). 미설정 시 생략.
   */
  chat_instructions?: string;
  /**
   * Hermes chat 모델 ID (OpenAI Responses `model` 파라미터). 예: "natsume" (Hermes `/v1/models`).
   * 모델 ID는 config 소관(하드코딩 금지). 미설정 시 streamChat은 model을 생략한다 —
   * model을 강제하는 backend엔 4xx가 날 수 있다(prod config는 반드시 설정).
   */
  chat_model?: string;
  /** 별도 ASR 서비스 (OpenAI 호환) → /audio/transcriptions. */
  stt_base_url: string;
  /** 별도 TTS 서비스 (OpenAI 호환) → /audio/speech. */
  tts_base_url: string;
  /** /v1/audio/speech model/voice/speed. 미설정 시 서비스 default. */
  tts_model?: string;
  tts_voice?: string;
  tts_speed?: number;
  /** TTS 합성 경로 선택. 미설정 시 loader가 "irodori"로 resolve한다. */
  tts_provider?: "openai" | "irodori";
  /** irodori_TTS 서버 root (http(s), 예: `http://localhost:8091`). provider=irodori일 때 필수. */
  irodori_base_url?: string;
  /** 활성 화자 reference_id(voice registry 등록 키). provider=irodori일 때 필수. */
  irodori_speaker?: string;
  /** 선택 가능한 화자 목록 — UI 표시 + voice registry 등록 소스. ref_url은 vite 서빙 경로(`/references/…`). */
  irodori_voices?: Array<{ id: string; label?: string; ref_url: string }>;
  /** diffusion step 수(품질/속도 trade-off). 미설정 시 서버 default. */
  irodori_num_steps?: number;
  /** emotion(text) adherence cfg scale. 미설정 시 서버 default. */
  irodori_cfg_scale_text?: number;
  /** speaker adherence cfg scale. 미설정 시 서버 default. */
  irodori_cfg_scale_speaker?: number;
  /** 목표 발화 길이(초). 미설정 시 서버 default. */
  irodori_seconds?: number;
  /** provider 무관 합성 동시성 상한. default 1(serial) — loader가 아니라 consumer(tts-pipeline)가 적용. */
  tts_max_inflight?: number;
  /** Expression Broker MCP endpoint(streamable-http, 예: `http://localhost:3201/mcp`). 미설정 시 vocab publish 스킵. */
  broker_base_url?: string;
  /** 활성 chat 모델의 최대 컨텍스트 토큰 수. */
  chat_model_context_window?: number;
  /** 자동 compaction을 요청하는 컨텍스트 점유 비율(loader default 0.7). */
  compact_threshold_ratio?: number;
  /** skipped 직후, 점유율이 이 비율 아래로 떨어졌다가 다시 넘어야 threshold가 재발동(loader default 0.5). */
  compact_resume_ratio?: number;
  /** 단일 compress 호출의 마감 시한(ms, loader default 12000). */
  compact_timeout_ms?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Client-only geometry (window-sit perch) ──
// backend contract 밖 — generate_express / ControlEnvelope에 싣지 않는 순수 렌더 입력.
// ─────────────────────────────────────────────────────────────────────────────

/** A rectangle in global screen coordinates (points, top-left origin). */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An on-screen foreign window (matches the Rust `list_windows()` / `WindowAtPoint` payload, points). */
export interface WindowRect extends ScreenRect {
  name: string | null;
  pid: number;
  /** kCGWindowNumber — stable window identity used to track the perched window across the stack. */
  windowNumber: number;
}

/** Client-only perch target handed to the renderer: which window edge the character sits on. */
export interface PerchTarget {
  rect: ScreenRect;
  edge: "top";
}
