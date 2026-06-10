/**
 * Config loader — configs/*.json 로더 + 검증.
 *
 * config-driven 원칙: API 엔드포인트 / 모델 / VRM 경로 / 모션셋을 하드코딩하지 않는다.
 * OSS 단계에서 API 키는 평문 config 대신 OS keychain(Tauri secure storage)로.
 *
 * 로드 대상(YUI 루트 configs/, vite dev는 `/configs/*`로 서빙):
 *  - endpoints.json          → EndpointsConfig (chat/stt/tts base url + chat endpoint)
 *  - avatar.json             → AvatarConfig (vrm_url)
 *  - emotion_registry.json   → EmotionRegistry (emotion id → vrm_expression + fallback)
 *  - motions.json            → MotionRegistry (id → vrma_path + 재생 정책)
 *
 * 이 파일은 순수 로드 + 검증만 담당한다(부수효과 없음, reader 주입 가능 → 테스트). 핫리로드/
 * 구독은 store.ts(createConfigStore)가 이 loadConfig를 감싸 제공한다.
 *
 * 합의된 contract는 도메인별 분리 파일이다. 구현은 분리 파일을 따른다.
 */

import type {
  EmotionId,
  EmotionRegistry,
  EmotionRegistryEntry,
  EndpointsConfig,
  InterruptPolicy,
  MotionKind,
  MotionRegistry,
  MotionRegistryEntry,
} from "../contract";

// ─────────────────────────────────────────────────────────────────────────────
// Config 타입 (contract 파생 + loader 전용)
// ─────────────────────────────────────────────────────────────────────────────

/** 선택 가능한 VRM 한 개 (모델 스왑 manifest 항목). */
export interface AvatarOption {
  /** 안정 키 (예: "carlotta"). 선택 상태 영속화에 쓰임. */
  id: string;
  /** 표시 이름 (예: "Carlotta"). */
  label: string;
  /** vrm_url과 동일 의미 — vite 경로 또는 절대 URL. */
  url: string;
  /** "file" = OS 파일 피커로 추가된 항목. 미지정 시 미상. */
  source?: "bundled" | "file";
}

/** configs/avatar.json — 로드할 VRM (렌더러 입력). */
export interface AvatarConfig {
  /** vite dev 정적 서빙 경로(`/vrms/*.vrm`) 또는 절대 URL. 기본 선택. */
  vrm_url: string;
  /** 선택 가능한 VRM 목록. 없으면 vrm_url 단일 모델. */
  available?: AvatarOption[];
  /** 전신 fit-to-bounds 카메라 knob. 없으면 렌더러 기본값. */
  framing?: { margin?: number; fov?: number };
}

/** configs/guardrails.json — DND/debounce/rate-limit 수치. */
export interface GuardrailsConfig {
  /** DND. */
  dnd: {
    /** active-app blocklist — 포함된 앱이 전경이면 DND on. */
    app_blocklist: string[];
    /** 카메라 신호 후 이 시간(ms) 무신호면 camera DND off. */
    camera_idle_off_ms: number;
  };
  /** per-source debounce window(ms). 0이면 디바운스 없음. */
  debounce_ms: {
    idle_watcher: number;
    os_event_watcher: number;
    backend_push_source: number;
    user_input_source: number;
  };
  /** rolling rate-limit. */
  rate_limit: {
    /** rolling 윈도우 길이(ms). */
    window_ms: number;
    /** tier2 상한. */
    tier2_max: number;
    /** tier3 상한. */
    tier3_max: number;
    /** backend 호출 전체 상한 — 초과 시 cooldown 진입. */
    overall_max: number;
    /** overall 초과 시 cooldown 지속(ms). */
    cooldown_ms: number;
  };
}

/** configs/sources.json — proactive 발화 소스 cadence/presence knob. */
export interface SourcesConfig {
  proactive: {
    cowork: {
      /** cowork tick 간격(ms). */
      interval_ms: number;
      /** 이 시간(ms) 내 입력이 있어야 present로 본다 — interval_ms보다 작아야 함. */
      present_max_idle_ms: number;
    };
  };
}

/** 로드·검증된 전체 config 묶음 (불변 스냅샷). */
export interface AppConfig {
  endpoints: EndpointsConfig;
  avatar: AvatarConfig;
  emotionRegistry: EmotionRegistry;
  motions: MotionRegistry;
  guardrails: GuardrailsConfig;
  sources: SourcesConfig;
}

/** AppConfig의 도메인 키 — 핫리로드가 "무엇이 바뀌었나"를 통지할 때 쓰는 단위(store.ts). */
export type ConfigSection = keyof AppConfig;

/** loadConfig가 fetch하는 configs/ 파일들 (section → 파일명). */
export const CONFIG_FILES: Record<ConfigSection, string> = {
  endpoints: "endpoints.json",
  avatar: "avatar.json",
  emotionRegistry: "emotion_registry.json",
  motions: "motions.json",
  guardrails: "guardrails.json",
  sources: "sources.json",
};

// ─────────────────────────────────────────────────────────────────────────────
// API 키 추상화 (OSS 진입 시 OS keychain 이주용 레이어)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 시크릿(예: chat api_key) 조회 추상화. 평문(plainSecretProvider) 또는
 * Tauri secure storage / OS keychain 구현으로 **호출부 변경 없이** 교체한다.
 * 비동기 시그니처는 keychain 접근(IPC)을 미리 수용하기 위함이다.
 */
export interface SecretProvider {
  /** 없으면 undefined. 절대 throw하지 않는다(키 부재는 정상 — 로컬 Hermes는 무인증). */
  get(key: string): Promise<string | undefined>;
}

/**
 * SecretProvider에서 Hermes chat 키를 찾을 때 쓰는 이름. backend env `API_SERVER_KEY`에 대응.
 * 호출부(dispatcher): `streamChat(ep, req, { apiKey: await secrets.get(CHAT_API_KEY_SECRET) })`.
 * (chat-client가 아니라 여기에 둔다 — secret 이름은 config/SecretProvider 소관, openai SDK 무관.)
 */
export const CHAT_API_KEY_SECRET = "chat_api_key";

/** 평문 레코드에서 조회. 실 값은 configs에 두지 않는 게 권장(env/keychain). */
export function plainSecretProvider(
  secrets: Record<string, string | undefined> = {},
): SecretProvider {
  return {
    async get(key) {
      return secrets[key];
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 에러 + reader
// ─────────────────────────────────────────────────────────────────────────────

/** config 로드/검증 실패. 항상 어떤 파일의 무엇이 잘못됐는지 명시한다(fail-loud). */
export class ConfigError extends Error {
  readonly file: string;
  readonly issues: string[];
  constructor(file: string, issues: string[]) {
    super(`[config] ${file}: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.file = file;
    this.issues = issues;
  }
}

/**
 * 파일 1개의 원시 JSON을 읽어 파싱해 반환. path는 파일명(예: "endpoints.json").
 * 기본 구현은 fetch(`<baseUrl>/<file>`); 테스트는 fake reader를 주입한다.
 */
export type ConfigReader = (file: string) => Promise<unknown>;

export interface LoadConfigOptions {
  /** 파일 reader 주입(테스트). 미지정 시 fetch 기반 기본 reader. */
  read?: ConfigReader;
  /** 기본 reader가 붙일 prefix. default `/configs`. */
  baseUrl?: string;
  /** 캐시 회피용 쿼리(핫리로드 재fetch 시 store가 넘김). */
  cacheBust?: string;
}

/** fetch 기반 기본 reader (브라우저/Tauri webview 런타임). */
function fetchReader(baseUrl: string, cacheBust?: string): ConfigReader {
  return async (file) => {
    const q = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : "";
    const url = `${baseUrl}/${file}${q}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new ConfigError(file, [`HTTP ${res.status} ${res.statusText} (${url})`]);
    }
    try {
      return await res.json();
    } catch {
      throw new ConfigError(file, ["응답이 JSON이 아님"]);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 검증 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_SOURCES: readonly NonNullable<AvatarOption["source"]>[] = ["bundled", "file"];
/** AvatarOption.id 허용 문자 — 영속화 키이자 CSS 셀렉터 `[data-vrm-id="…"]` 값이므로 공백/특수문자 금지. */
const AVATAR_ID_RE = /^[A-Za-z0-9._-]+$/;
const MOTION_KINDS: readonly MotionKind[] = ["ambient", "reactive", "state", "oneshot"];
const INTERRUPT_POLICIES: readonly InterruptPolicy[] = ["replace", "queue", "ignore"];
const VARIANT_POLICIES: readonly NonNullable<MotionRegistryEntry["variant_policy"]>[] = [
  "random",
  "sequential",
];
/** emotion enum 10종. registry 키는 이 집합에 한정(오탈자 키 fail-loud). */
const EMOTION_IDS: ReadonlySet<EmotionId> = new Set<EmotionId>([
  "neutral", "happy", "angry", "sad", "relaxed",
  "surprised", "thinking", "curious", "sleepy", "embarrassed",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** issues가 하나라도 있으면 ConfigError로 던진다. */
function assertValid(file: string, issues: string[]): void {
  if (issues.length > 0) throw new ConfigError(file, issues);
}

function validateEndpoints(file: string, raw: unknown): EndpointsConfig {
  const issues: string[] = [];
  if (!isObject(raw)) {
    throw new ConfigError(file, ["객체가 아님"]);
  }
  const httpUrl = (k: string): string => {
    const v = raw[k];
    if (typeof v !== "string" || !/^https?:\/\//.test(v)) {
      issues.push(`${k}는 http(s) URL이어야 함 (받음: ${JSON.stringify(v)})`);
      return "";
    }
    return v;
  };
  const chat_base_url = httpUrl("chat_base_url");
  const stt_base_url = httpUrl("stt_base_url");
  const tts_base_url = httpUrl("tts_base_url");
  const chat_endpoint = raw.chat_endpoint;
  // "/v1/responses" 형태의 경로만 허용. "//host"(protocol-relative)는 base_url과 합쳐도
  // 경로로 동작하지 않으므로 거부한다.
  if (
    typeof chat_endpoint !== "string" ||
    !chat_endpoint.startsWith("/") ||
    chat_endpoint.startsWith("//")
  ) {
    issues.push(`chat_endpoint는 "/"로 시작하는 경로여야 함 (받음: ${JSON.stringify(chat_endpoint)})`);
  }
  // chat_model: optional. 있으면 비어있지 않은 문자열이어야 함(모델 ID는 config 소관).
  const chat_model = raw.chat_model;
  if (chat_model !== undefined && (typeof chat_model !== "string" || chat_model.trim() === "")) {
    issues.push(`chat_model은 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(chat_model)})`);
  }
  // chat_instructions: optional. 있으면 문자열이어야 함(Responses `instructions` nudge, config 소관).
  const chat_instructions = raw.chat_instructions;
  if (chat_instructions !== undefined && typeof chat_instructions !== "string") {
    issues.push(`chat_instructions는 문자열이어야 함 (받음: ${JSON.stringify(chat_instructions)})`);
  }
  // tts_model / tts_voice: optional. 미설정 시 TTS 서비스 기본값.
  const optStr = (k: "tts_model" | "tts_voice"): string | undefined => {
    const v = raw[k];
    if (v !== undefined && (typeof v !== "string" || v.trim() === "")) {
      issues.push(`${k}는 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(v)})`);
      return undefined;
    }
    return typeof v === "string" ? v : undefined;
  };
  const tts_model = optStr("tts_model");
  const tts_voice = optStr("tts_voice");
  // tts_speed: optional, [0.25, 4.0].
  const tts_speed = raw.tts_speed;
  if (
    tts_speed !== undefined &&
    (typeof tts_speed !== "number" || tts_speed < 0.25 || tts_speed > 4)
  ) {
    issues.push(`tts_speed는 0.25~4.0 숫자여야 함 (받음: ${JSON.stringify(tts_speed)})`);
  }

  // ── irodori_TTS provider (additive) ──────────────────────────────────────────
  // tts_provider: optional enum. 미설정 시 irodori로 resolve(출력엔 resolved 값을 박는다).
  const rawProvider = raw.tts_provider;
  if (rawProvider !== undefined && rawProvider !== "openai" && rawProvider !== "irodori") {
    issues.push(`tts_provider는 "openai" | "irodori" 중 하나여야 함 (받음: ${JSON.stringify(rawProvider)})`);
  }
  const tts_provider: EndpointsConfig["tts_provider"] =
    rawProvider === "openai" ? "openai" : "irodori";

  // provider=irodori면 base_url(http url) + speaker(non-empty)는 필수 — bare config fail-loud.
  let irodori_base_url: string | undefined;
  if (raw.irodori_base_url !== undefined || tts_provider === "irodori") {
    irodori_base_url = httpUrl("irodori_base_url");
  }
  const irodori_speaker = raw.irodori_speaker;
  if (tts_provider === "irodori" || irodori_speaker !== undefined) {
    if (typeof irodori_speaker !== "string" || irodori_speaker.trim() === "") {
      issues.push(`irodori_speaker는 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(irodori_speaker)})`);
    }
  }

  // irodori_voices: optional. 배열이며 각 항목은 {id, ref_url("/" 시작), label?}.
  type IrodoriVoice = NonNullable<EndpointsConfig["irodori_voices"]>[number];
  let irodori_voices: IrodoriVoice[] | undefined;
  const rawVoices = raw.irodori_voices;
  if (rawVoices !== undefined) {
    if (!Array.isArray(rawVoices)) {
      issues.push(`irodori_voices는 배열이어야 함 (받음: ${JSON.stringify(rawVoices)})`);
    } else {
      irodori_voices = [];
      rawVoices.forEach((entry, i) => {
        if (!isObject(entry)) {
          issues.push(`irodori_voices[${i}]: 항목이 객체가 아님`);
          return;
        }
        if (typeof entry.id !== "string" || entry.id.length === 0) {
          issues.push(`irodori_voices[${i}].id는 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(entry.id)})`);
        }
        if (typeof entry.ref_url !== "string" || !entry.ref_url.startsWith("/")) {
          issues.push(`irodori_voices[${i}].ref_url는 "/"로 시작하는 경로여야 함 (받음: ${JSON.stringify(entry.ref_url)})`);
        }
        if (entry.label !== undefined && typeof entry.label !== "string") {
          issues.push(`irodori_voices[${i}].label는 문자열이어야 함 (받음: ${JSON.stringify(entry.label)})`);
        }
        irodori_voices!.push({
          id: entry.id as string,
          ref_url: entry.ref_url as string,
          ...(typeof entry.label === "string" ? { label: entry.label } : {}),
        });
      });
    }
  }

  // irodori_num_steps: optional, 정수 ≥ 1.
  const irodori_num_steps = raw.irodori_num_steps;
  if (
    irodori_num_steps !== undefined &&
    (typeof irodori_num_steps !== "number" || !Number.isInteger(irodori_num_steps) || irodori_num_steps < 1)
  ) {
    issues.push(`irodori_num_steps는 1 이상 정수여야 함 (받음: ${JSON.stringify(irodori_num_steps)})`);
  }
  // irodori_cfg_scale_text / _speaker / seconds: optional, 유한 number > 0.
  const posNum = (k: "irodori_cfg_scale_text" | "irodori_cfg_scale_speaker" | "irodori_seconds"): void => {
    const v = raw[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v <= 0)) {
      issues.push(`${k}는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(v)})`);
    }
  };
  posNum("irodori_cfg_scale_text");
  posNum("irodori_cfg_scale_speaker");
  posNum("irodori_seconds");
  // broker_base_url: optional. 있으면 http(s) URL이어야 함(Expression Broker MCP endpoint).
  let broker_base_url: string | undefined;
  if (raw.broker_base_url !== undefined) {
    broker_base_url = httpUrl("broker_base_url");
  }
  // tts_max_inflight: optional, 정수 ≥ 1.
  const tts_max_inflight = raw.tts_max_inflight;
  if (
    tts_max_inflight !== undefined &&
    (typeof tts_max_inflight !== "number" || !Number.isInteger(tts_max_inflight) || tts_max_inflight < 1)
  ) {
    issues.push(`tts_max_inflight는 1 이상 정수여야 함 (받음: ${JSON.stringify(tts_max_inflight)})`);
  }

  // ── compaction knobs ─────────────────────────────────────────────────────────
  // chat_model_context_window: optional, 유한 number > 0. 미설정 시 undefined.
  const chat_model_context_window = raw.chat_model_context_window;
  if (
    chat_model_context_window !== undefined &&
    (typeof chat_model_context_window !== "number" ||
      !Number.isFinite(chat_model_context_window) ||
      chat_model_context_window <= 0)
  ) {
    issues.push(`chat_model_context_window는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(chat_model_context_window)})`);
  }
  // ratio((0,1]) 검증 후 미설정 시 default로 resolve(출력엔 resolved 값을 박는다).
  const ratio = (k: "compact_threshold_ratio" | "compact_resume_ratio", def: number): number => {
    const v = raw[k];
    if (v === undefined) return def;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1) {
      issues.push(`${k}는 (0, 1] 범위 유한 number여야 함 (받음: ${JSON.stringify(v)})`);
      return def;
    }
    return v;
  };
  const compact_threshold_ratio = ratio("compact_threshold_ratio", 0.7);
  const compact_resume_ratio = ratio("compact_resume_ratio", 0.5);
  // compact_timeout_ms: 유한 number > 0. 미설정 시 default로 resolve.
  const rawTimeout = raw.compact_timeout_ms;
  let compact_timeout_ms = 12000;
  if (rawTimeout !== undefined) {
    if (typeof rawTimeout !== "number" || !Number.isFinite(rawTimeout) || rawTimeout <= 0) {
      issues.push(`compact_timeout_ms는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(rawTimeout)})`);
    } else {
      compact_timeout_ms = rawTimeout;
    }
  }

  assertValid(file, issues);
  return {
    chat_base_url,
    chat_endpoint: chat_endpoint as string,
    ...(typeof chat_instructions === "string" ? { chat_instructions } : {}),
    ...(typeof chat_model === "string" ? { chat_model } : {}),
    stt_base_url,
    tts_base_url,
    ...(tts_model !== undefined ? { tts_model } : {}),
    ...(tts_voice !== undefined ? { tts_voice } : {}),
    ...(typeof tts_speed === "number" ? { tts_speed } : {}),
    tts_provider,
    ...(irodori_base_url !== undefined ? { irodori_base_url } : {}),
    ...(typeof irodori_speaker === "string" ? { irodori_speaker } : {}),
    ...(irodori_voices !== undefined ? { irodori_voices } : {}),
    ...(typeof irodori_num_steps === "number" ? { irodori_num_steps } : {}),
    ...(typeof raw.irodori_cfg_scale_text === "number" ? { irodori_cfg_scale_text: raw.irodori_cfg_scale_text } : {}),
    ...(typeof raw.irodori_cfg_scale_speaker === "number" ? { irodori_cfg_scale_speaker: raw.irodori_cfg_scale_speaker } : {}),
    ...(typeof raw.irodori_seconds === "number" ? { irodori_seconds: raw.irodori_seconds } : {}),
    ...(typeof tts_max_inflight === "number" ? { tts_max_inflight } : {}),
    ...(broker_base_url ? { broker_base_url } : {}),
    ...(typeof chat_model_context_window === "number" ? { chat_model_context_window } : {}),
    compact_threshold_ratio,
    compact_resume_ratio,
    compact_timeout_ms,
  };
}

function validateAvatar(file: string, raw: unknown): AvatarConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const vrm_url = raw.vrm_url;
  if (typeof vrm_url !== "string" || vrm_url.length === 0) {
    throw new ConfigError(file, [`vrm_url은 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(vrm_url)})`]);
  }
  const issues: string[] = [];

  // available[] — optional VRM swap manifest.
  let available: AvatarOption[] | undefined;
  const rawAvailable = raw.available;
  if (rawAvailable !== undefined) {
    if (!Array.isArray(rawAvailable)) {
      throw new ConfigError(file, [`available은 배열이어야 함 (받음: ${JSON.stringify(rawAvailable)})`]);
    }
    available = [];
    rawAvailable.forEach((entry, i) => {
      if (!isObject(entry)) {
        issues.push(`available[${i}]: 항목이 객체가 아님`);
        return;
      }
      for (const k of ["id", "label", "url"] as const) {
        if (typeof entry[k] !== "string" || (entry[k] as string).length === 0) {
          issues.push(`available[${i}].${k}는 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(entry[k])})`);
        }
      }
      // id는 영속화 키 + CSS 셀렉터 값 — 공백/따옴표 등 특수문자 금지([A-Za-z0-9._-]).
      if (typeof entry.id === "string" && !AVATAR_ID_RE.test(entry.id)) {
        issues.push(`available[${i}].id는 [A-Za-z0-9._-]만 허용 (받음: ${JSON.stringify(entry.id)})`);
      }
      const source = entry.source;
      if (source !== undefined && !AVATAR_SOURCES.includes(source as AvatarOption["source"] & string)) {
        issues.push(`available[${i}].source는 ${AVATAR_SOURCES.join("|")} 중 하나여야 함 (받음: ${JSON.stringify(source)})`);
      }
      available!.push({
        id: entry.id as string,
        label: entry.label as string,
        url: entry.url as string,
        ...(source !== undefined ? { source: source as AvatarOption["source"] } : {}),
      });
    });
    // id 유일성 — find(x => x.id === …) 해소가 첫 항목만 잡으므로 중복은 영구 unreachable.
    const seen = new Set<string>();
    available.forEach((opt, i) => {
      if (seen.has(opt.id)) {
        issues.push(`available[${i}].id 중복: ${JSON.stringify(opt.id)}`);
      }
      seen.add(opt.id);
    });
  }

  // framing — optional fit-to-bounds knob. 부분값 허용(기본값은 렌더러 소유).
  let framing: AvatarConfig["framing"];
  const rawFraming = raw.framing;
  if (rawFraming !== undefined) {
    if (!isObject(rawFraming)) {
      issues.push(`framing은 객체여야 함 (받음: ${JSON.stringify(rawFraming)})`);
    } else {
      const { margin, fov } = rawFraming;
      if (margin !== undefined && (typeof margin !== "number" || !Number.isFinite(margin) || margin < 0)) {
        issues.push(`framing.margin은 0 이상 유한 number여야 함 (받음: ${JSON.stringify(margin)})`);
      }
      if (fov !== undefined && (typeof fov !== "number" || !Number.isFinite(fov) || fov <= 0 || fov >= 180)) {
        issues.push(`framing.fov는 (0, 180) 열린구간 number여야 함 (받음: ${JSON.stringify(fov)})`);
      }
      framing = {
        ...(typeof margin === "number" ? { margin } : {}),
        ...(typeof fov === "number" ? { fov } : {}),
      };
    }
  }

  assertValid(file, issues);
  return {
    vrm_url,
    ...(available !== undefined ? { available } : {}),
    ...(framing !== undefined ? { framing } : {}),
  };
}

function validateEmotionRegistry(file: string, raw: unknown): EmotionRegistry {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  const out: EmotionRegistry = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!EMOTION_IDS.has(id as EmotionId)) {
      issues.push(`${id}: 알 수 없는 emotion id (enum 외)`);
      continue;
    }
    if (!isObject(entry)) {
      issues.push(`${id}: 항목이 객체가 아님`);
      continue;
    }
    if (typeof entry.vrm_expression !== "string") {
      issues.push(`${id}.vrm_expression은 문자열이어야 함`);
      continue;
    }
    if (typeof entry.fallback !== "string") {
      issues.push(`${id}.fallback은 문자열이어야 함`);
      continue;
    }
    out[id as EmotionId] = {
      vrm_expression: entry.vrm_expression,
      fallback: entry.fallback,
    } satisfies EmotionRegistryEntry;
  }
  assertValid(file, issues);
  return out;
}

function validateMotions(file: string, raw: unknown): MotionRegistry {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  const out: MotionRegistry = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isObject(entry)) {
      issues.push(`${id}: 항목이 객체가 아님`);
      continue;
    }
    if (typeof entry.vrma_path !== "string" || !entry.vrma_path.endsWith(".vrma")) {
      issues.push(`${id}.vrma_path는 .vrma로 끝나는 문자열이어야 함`);
    }
    if (!MOTION_KINDS.includes(entry.kind as MotionKind)) {
      issues.push(`${id}.kind는 ${MOTION_KINDS.join("|")} 중 하나여야 함 (받음: ${JSON.stringify(entry.kind)})`);
    }
    if (typeof entry.loop !== "boolean") {
      issues.push(`${id}.loop은 boolean이어야 함`);
    }
    // priority 0~100. typeof number는 NaN/Infinity를 통과시키므로 범위까지 본다.
    if (
      typeof entry.priority !== "number" ||
      !Number.isFinite(entry.priority) ||
      entry.priority < 0 ||
      entry.priority > 100
    ) {
      issues.push(`${id}.priority는 0~100 사이 유한 number여야 함 (받음: ${JSON.stringify(entry.priority)})`);
    }
    if (!INTERRUPT_POLICIES.includes(entry.interrupt_policy as InterruptPolicy)) {
      issues.push(`${id}.interrupt_policy는 ${INTERRUPT_POLICIES.join("|")} 중 하나여야 함`);
    }
    // variants: 있으면 .vrma 문자열 2개 이상 풀. 1개짜리는 무의미.
    const rawVariants = entry.variants;
    let variants: string[] | undefined;
    if (rawVariants !== undefined) {
      if (!Array.isArray(rawVariants) || rawVariants.some((v) => typeof v !== "string")) {
        issues.push(`${id}.variants는 문자열 배열이어야 함`);
      } else if (rawVariants.length < 2) {
        issues.push(`${id}.variants는 2개 이상이어야 함 (받음: ${rawVariants.length}개)`);
      } else if (rawVariants.some((v) => !(v as string).endsWith(".vrma"))) {
        issues.push(`${id}.variants의 각 항목은 .vrma로 끝나야 함`);
      } else {
        variants = rawVariants as string[];
      }
    }
    const rawVariantPolicy = entry.variant_policy;
    let variant_policy: MotionRegistryEntry["variant_policy"];
    if (rawVariantPolicy !== undefined) {
      if (!VARIANT_POLICIES.includes(rawVariantPolicy as NonNullable<typeof variant_policy>)) {
        issues.push(`${id}.variant_policy는 ${VARIANT_POLICIES.join("|")} 중 하나여야 함`);
      } else {
        variant_policy = rawVariantPolicy as MotionRegistryEntry["variant_policy"];
      }
    }
    // variants 없는 variant_policy는 resolve()가 무시하는 dead 필드 — fail-loud.
    if (rawVariantPolicy !== undefined && rawVariants === undefined) {
      issues.push(`${id}.variant_policy는 variants 없이 의미 없음 (variants 필요)`);
    }
    const rawBrokerPublish = entry.broker_publish;
    let broker_publish: boolean | undefined;
    if (rawBrokerPublish !== undefined) {
      if (typeof rawBrokerPublish !== "boolean") {
        issues.push(`${id}.broker_publish는 boolean이어야 함`);
      } else {
        broker_publish = rawBrokerPublish;
      }
    }
    // cycle_dwell_ms: cycle 모션이 다음 variant로 swap하기 전 정착 프레임 유지 ms.
    const rawCycleDwell = entry.cycle_dwell_ms;
    let cycle_dwell_ms: number | undefined;
    if (rawCycleDwell !== undefined) {
      if (
        typeof rawCycleDwell !== "number" ||
        !Number.isInteger(rawCycleDwell) ||
        rawCycleDwell < 0 ||
        rawCycleDwell > 60000
      ) {
        issues.push(`${id}.cycle_dwell_ms는 0~60000 사이 정수여야 함`);
      } else {
        cycle_dwell_ms = rawCycleDwell;
      }
      // cycle 모션(variants>1 + loop)이 아니면 resolve()가 무시하는 dead 필드 — fail-loud.
      if (!(Array.isArray(variants) && variants.length > 1 && entry.loop === true)) {
        issues.push(`${id}.cycle_dwell_ms는 cycle 모션(variants>1 + loop)에만 유효함`);
      }
    }
    // fade_ms: entry-level default crossfade ms. 모든 항목에 유효.
    const rawFade = entry.fade_ms;
    let fade_ms: number | undefined;
    if (rawFade !== undefined) {
      if (
        typeof rawFade !== "number" ||
        !Number.isInteger(rawFade) ||
        rawFade < 0 ||
        rawFade > 5000
      ) {
        issues.push(`${id}.fade_ms는 0~5000 사이 정수여야 함`);
      } else {
        fade_ms = rawFade;
      }
    }
    out[id] = {
      vrma_path: entry.vrma_path as string,
      ...(variants !== undefined ? { variants } : {}),
      ...(variant_policy !== undefined ? { variant_policy } : {}),
      ...(cycle_dwell_ms !== undefined ? { cycle_dwell_ms } : {}),
      ...(fade_ms !== undefined ? { fade_ms } : {}),
      ...(broker_publish !== undefined ? { broker_publish } : {}),
      kind: entry.kind as MotionKind,
      loop: entry.loop as boolean,
      priority: entry.priority as number,
      interrupt_policy: entry.interrupt_policy as InterruptPolicy,
    } satisfies MotionRegistryEntry;
  }
  if (Object.keys(out).length === 0) issues.push("최소 1개 모션이 등록되어야 함");
  assertValid(file, issues);
  return out;
}

function validateGuardrails(file: string, raw: unknown): GuardrailsConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  /** obj[key]가 유한 number ≥ 0인지. 아니면 issue 추가하고 0 반환. */
  const nonNegNum = (obj: Record<string, unknown>, path: string, key: string): number => {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      issues.push(`${path}.${key}는 0 이상 유한 number여야 함 (받음: ${JSON.stringify(v)})`);
      return 0;
    }
    return v;
  };

  // dnd
  const rawDnd = raw.dnd;
  let app_blocklist: string[] = [];
  let camera_idle_off_ms = 0;
  if (!isObject(rawDnd)) {
    issues.push(`dnd는 객체여야 함 (받음: ${JSON.stringify(rawDnd)})`);
  } else {
    const rawBlocklist = rawDnd.app_blocklist;
    if (!Array.isArray(rawBlocklist) || rawBlocklist.some((v) => typeof v !== "string")) {
      issues.push(`dnd.app_blocklist는 string[]이어야 함 (받음: ${JSON.stringify(rawBlocklist)})`);
    } else {
      app_blocklist = rawBlocklist as string[];
    }
    camera_idle_off_ms = nonNegNum(rawDnd, "dnd", "camera_idle_off_ms");
  }

  // debounce_ms
  const rawDebounce = raw.debounce_ms;
  const debounce_ms = { idle_watcher: 0, os_event_watcher: 0, backend_push_source: 0, user_input_source: 0 };
  if (!isObject(rawDebounce)) {
    issues.push(`debounce_ms는 객체여야 함 (받음: ${JSON.stringify(rawDebounce)})`);
  } else {
    for (const k of Object.keys(debounce_ms) as (keyof typeof debounce_ms)[]) {
      debounce_ms[k] = nonNegNum(rawDebounce, "debounce_ms", k);
    }
  }

  // rate_limit
  const rawRate = raw.rate_limit;
  const rate_limit = { window_ms: 0, tier2_max: 0, tier3_max: 0, overall_max: 0, cooldown_ms: 0 };
  if (!isObject(rawRate)) {
    issues.push(`rate_limit는 객체여야 함 (받음: ${JSON.stringify(rawRate)})`);
  } else {
    for (const k of Object.keys(rate_limit) as (keyof typeof rate_limit)[]) {
      rate_limit[k] = nonNegNum(rawRate, "rate_limit", k);
    }
  }

  assertValid(file, issues);
  return { dnd: { app_blocklist, camera_idle_off_ms }, debounce_ms, rate_limit };
}

function validateSources(file: string, raw: unknown): SourcesConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];

  const proactive = raw.proactive;
  let interval_ms = 0;
  let present_max_idle_ms = 0;
  if (!isObject(proactive)) {
    issues.push(`proactive는 객체여야 함 (받음: ${JSON.stringify(proactive)})`);
  } else {
    const cowork = proactive.cowork;
    if (!isObject(cowork)) {
      issues.push(`proactive.cowork는 객체여야 함 (받음: ${JSON.stringify(cowork)})`);
    } else {
      const iv = cowork.interval_ms;
      if (typeof iv !== "number" || !Number.isFinite(iv) || iv <= 0) {
        issues.push(`proactive.cowork.interval_ms는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(iv)})`);
      } else {
        interval_ms = iv;
      }
      const idle = cowork.present_max_idle_ms;
      if (typeof idle !== "number" || !Number.isFinite(idle) || idle <= 0) {
        issues.push(`proactive.cowork.present_max_idle_ms는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(idle)})`);
      } else if (idle < 10000) {
        issues.push(`proactive.cowork.present_max_idle_ms는 ≥ 10000ms (≥ 2 nominal ~5s ticks)여야 함 (받음: ${JSON.stringify(idle)})`);
      } else {
        present_max_idle_ms = idle;
      }
      if (interval_ms > 0 && present_max_idle_ms > 0 && present_max_idle_ms >= interval_ms) {
        issues.push(`proactive.cowork.present_max_idle_ms(${present_max_idle_ms})는 interval_ms(${interval_ms})보다 작아야 함`);
      }
    }
  }

  assertValid(file, issues);
  return { proactive: { cowork: { interval_ms, present_max_idle_ms } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// loadConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * configs/*.json 전체를 읽어 검증된 AppConfig로 조립한다.
 * 어느 파일이든 누락/스키마 위반이면 ConfigError로 즉시 실패한다(fail-loud, 부분 로드 없음).
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<AppConfig> {
  const read = opts.read ?? fetchReader(opts.baseUrl ?? "/configs", opts.cacheBust);

  // 파일별 read는 병렬, 검증은 결정적 순서로.
  const [endpointsRaw, avatarRaw, emotionRegistryRaw, motionsRaw, guardrailsRaw, sourcesRaw] =
    await Promise.all([
      read(CONFIG_FILES.endpoints),
      read(CONFIG_FILES.avatar),
      read(CONFIG_FILES.emotionRegistry),
      read(CONFIG_FILES.motions),
      read(CONFIG_FILES.guardrails),
      read(CONFIG_FILES.sources),
    ]);

  return {
    endpoints: validateEndpoints(CONFIG_FILES.endpoints, endpointsRaw),
    avatar: validateAvatar(CONFIG_FILES.avatar, avatarRaw),
    emotionRegistry: validateEmotionRegistry(CONFIG_FILES.emotionRegistry, emotionRegistryRaw),
    motions: validateMotions(CONFIG_FILES.motions, motionsRaw),
    guardrails: validateGuardrails(CONFIG_FILES.guardrails, guardrailsRaw),
    sources: validateSources(CONFIG_FILES.sources, sourcesRaw),
  };
}
