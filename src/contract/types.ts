/**
 * YUI ↔ Hermes contract — TypeScript types.
 *
 * 원천(source of truth): docs/contract.md §1~§4. 이 파일은 그 스키마를 TS로 옮긴 것이며,
 * 임의로 필드를 추가/변경하지 않는다. 스키마가 바뀌면 contract.md를 먼저 고친다.
 *
 * 전송 규약 요지(contract.md §Endpoint, §3 / prd.md D-TRANSPORT/D-SPEECH):
 *  - 제어신호(emotion/motion/should_speak)는 서버사이드 `express` tool-call의 arguments로 도착.
 *  - 발화 텍스트는 tool-call이 아니라 별도 assistant 텍스트 스트림(response.output_text.delta).
 *  - express·emotion은 둘 다 optional — 없는 턴은 idle + 직전 표정 유지.
 */

// ─────────────────────────────────────────────────────────────────────────────
// §1. Emotion Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * backend가 turn마다 보낼 수 있는 emotion enum (contract.md §1).
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
 * configs/emotion_registry.json 한 항목 (contract.md §1 "매핑").
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
// §2. Motion Registry
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
 * configs/motions.json 한 항목 (contract.md §2). registry가 priority/interrupt의 진실의 원천 —
 * backend는 ID 문자열만 알면 된다.
 *
 * [D-MOTION-VARIANTS] variants / variant_policy는 v0 클라이언트 사이드 확장.
 * contract.md §2 반영은 Docs 에이전트 담당.
 */
export interface MotionRegistryEntry {
  /** VRMA 파일 경로 (Vite public → "/motions/<id>.vrma"). variants 사용 시 기본/대표 경로(=variants[0]). */
  vrma_path: string;
  /** NEW(D-MOTION-VARIANTS): 2개 이상의 VRMA 풀. 있으면 클라이언트가 entry마다 한 개를 골라 재생(variant_policy). 없으면 vrma_path 단일 사용. */
  variants?: string[];
  /** NEW: variants가 있을 때 선택 정책. default "random". */
  variant_policy?: "random" | "sequential";
  kind: MotionKind;
  loop: boolean;
  /** 0~100, 높을수록 우선. */
  priority: number;
  interrupt_policy: InterruptPolicy;
}

export type MotionRegistry = Record<string, MotionRegistryEntry>;

// ─────────────────────────────────────────────────────────────────────────────
// §3. Control Signal Envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `express` tool-call의 arguments = transport 페이로드 (contract.md §3).
 * 이것만이 실제로 wire를 타는 제어 필드다. 전부 optional — express 없는 턴은 비어 있다.
 */
export interface ExpressArgs {
  /** default true. false면 TTS/말풍선 스킵 (Tier 2 silence). */
  should_speak?: boolean;
  /** 없으면 직전 표정 유지. */
  emotion?: EmotionSignal | null;
  /** 없거나 null이면 idle로 복귀. */
  motion?: MotionSignal | null;
}

/** rich_content 항목 (contract.md §3). MVP는 텍스트 마크다운으로 렌더 — 구조화 카드는 P2. */
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

/** Hermes 네이티브 tool의 function_call item을 client가 관찰해 도출 (express 아님). */
export interface ToolStatus {
  state: "idle" | "running" | "done" | "error";
  /** function_call name 기반 라벨. ex: "검색 중…". */
  label?: string;
  /** function_call name. */
  tool_id?: string;
}

/**
 * client 내부 정규화 형태 (contract.md §3). express arguments + 텍스트 스트림 + 네이티브
 * function_call 관찰을 합친 render directive 입력. wire 스키마가 아니라 client가 재구성하는 형태.
 */
export interface ControlEnvelope {
  // --- express tool-call arguments (있을 때만) ---
  should_speak?: boolean;
  emotion?: EmotionSignal | null;
  motion?: MotionSignal | null;

  // --- 텍스트 스트림에서 조립 (tool 필드 아님) ---
  /** response.output_text.delta 누적. 발화 없으면 "". */
  speech_text: string;

  // --- Hermes 네이티브 tool function_call item 관찰로 도출 ---
  tool_status?: ToolStatus | null;

  /** P2. MVP는 발화 텍스트의 마크다운으로 인라인 렌더. */
  rich_content?: RichItem[];

  /** v0에서 전부 무시 (contract.md §3 렌더 규약 6). */
  _reserved?: {
    expression_frames?: unknown[];
    visemes?: unknown[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §4. Input Context Schema (client → backend)
// ─────────────────────────────────────────────────────────────────────────────

/** 캡처 소스 (contract.md §4). 사용자가 monitor / browser tab / window 중 선택. */
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
// Endpoint config (contract.md §Endpoint abstraction)
// ─────────────────────────────────────────────────────────────────────────────

/** configs/endpoints.json (contract.md §Endpoint). chat/stt/tts 세 base URL은 서로 다른 프로세스. */
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
   * Hermes chat 모델 ID (OpenAI Responses `model` 파라미터). 예: "natsume" (Hermes `/v1/models`).
   * PRD F8: 모델 ID는 config 소관(하드코딩 금지). 미설정 시 streamChat은 model을 생략한다 —
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
}
