/**
 * Config loader — configs/*.json 로더 + 검증. (PRD F8 / concept.md §2.F, contract.md §Endpoint)
 *
 * config-driven 원칙(concept.md §1): API 엔드포인트 / 모델 / VRM 경로 / 모션셋을 하드코딩하지 않는다.
 * OSS 단계에서 API 키는 평문 config 대신 OS keychain(Tauri secure storage)로 — concept.md §2.F.
 *
 * 로드 대상(YUI 루트 configs/, vite dev는 `/configs/*`로 서빙 — vite.config.ts):
 *  - endpoints.json          → EndpointsConfig (chat/stt/tts base url + chat endpoint)
 *  - avatar.json             → AvatarConfig (vrm_url, #4)
 *  - emotion_registry.json   → EmotionRegistry (emotion id → vrm_expression + fallback)
 *  - emotion_tts_prefix.json → emotion id → TTS prefix (TBD 스텁, 발명 금지 — D-EMOTION-DUAL)
 *  - motions.json            → MotionRegistry (id → vrma_path + 재생 정책)
 *
 * 이 파일은 순수 로드 + 검증만 담당한다(부수효과 없음, reader 주입 가능 → 테스트). 핫리로드/
 * 구독은 store.ts(createConfigStore)가 이 loadConfig를 감싸 제공한다.
 *
 * ⚠ PRD F8은 "단일 config.toml/.json" 아이디어로 적혀 있으나, 실제 합의된 contract(AGENTS.md ·
 *   configs/*.json · contract.md)는 도메인별 분리 파일이다. 구현은 분리 파일을 따른다.
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

/** configs/avatar.json — 로드할 VRM (contract: #4 렌더러 입력). */
export interface AvatarConfig {
  /** vite dev 정적 서빙 경로(`/vrms/*.vrm`) 또는 절대 URL. */
  vrm_url: string;
}

/** emotion_tts_prefix.json 형태 — TBD 스텁(contract.md §1, D-EMOTION-DUAL). 토큰 발명 금지. */
export interface EmotionTtsPrefixConfig {
  _version: string;
  _status: string;
  /** enum별 prefix는 TTS 구현 시 사용자 확정 후 채운다. 지금은 비어 있거나 부분. */
  prefixes?: Partial<Record<EmotionId, string>>;
}

/** 로드·검증된 전체 config 묶음 (불변 스냅샷). */
export interface AppConfig {
  endpoints: EndpointsConfig;
  avatar: AvatarConfig;
  emotionRegistry: EmotionRegistry;
  emotionTtsPrefix: EmotionTtsPrefixConfig;
  motions: MotionRegistry;
}

/** AppConfig의 도메인 키 — 핫리로드가 "무엇이 바뀌었나"를 통지할 때 쓰는 단위(store.ts). */
export type ConfigSection = keyof AppConfig;

/** loadConfig가 fetch하는 configs/ 파일들 (section → 파일명). */
export const CONFIG_FILES: Record<ConfigSection, string> = {
  endpoints: "endpoints.json",
  avatar: "avatar.json",
  emotionRegistry: "emotion_registry.json",
  emotionTtsPrefix: "emotion_tts_prefix.json",
  motions: "motions.json",
};

// ─────────────────────────────────────────────────────────────────────────────
// API 키 추상화 (concept.md §2.F — OSS 진입 시 OS keychain 이주용 레이어)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 시크릿(예: chat api_key) 조회 추상화. MVP는 평문(plainSecretProvider), OSS 단계는
 * Tauri secure storage / OS keychain 구현으로 **호출부 변경 없이** 교체한다.
 * 비동기 시그니처는 keychain 접근(IPC)을 미리 수용하기 위함이다.
 */
export interface SecretProvider {
  /** 없으면 undefined. 절대 throw하지 않는다(키 부재는 정상 — 로컬 Hermes는 무인증). */
  get(key: string): Promise<string | undefined>;
}

/**
 * SecretProvider에서 Hermes chat 키를 찾을 때 쓰는 이름. backend env `API_SERVER_KEY`에 대응.
 * 호출부(dispatcher #21): `streamChat(ep, req, { apiKey: await secrets.get(CHAT_API_KEY_SECRET) })`.
 * (chat-client가 아니라 여기에 둔다 — secret 이름은 config/SecretProvider 소관, openai SDK 무관.)
 */
export const CHAT_API_KEY_SECRET = "chat_api_key";

/** MVP 기본 구현 — 평문 레코드에서 조회. 실 값은 configs에 두지 않는 게 권장(env/keychain). */
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

const MOTION_KINDS: readonly MotionKind[] = ["ambient", "reactive", "state", "oneshot"];
const INTERRUPT_POLICIES: readonly InterruptPolicy[] = ["replace", "queue", "ignore"];
/** contract.md §1 emotion enum 10종. registry 키는 이 집합에 한정(오탈자 키 fail-loud). */
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
  // chat_model: optional. 있으면 비어있지 않은 문자열이어야 함(PRD F8 모델 ID는 config 소관).
  const chat_model = raw.chat_model;
  if (chat_model !== undefined && (typeof chat_model !== "string" || chat_model.trim() === "")) {
    issues.push(`chat_model은 비어있지 않은 문자열이어야 함 (받음: ${JSON.stringify(chat_model)})`);
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
  assertValid(file, issues);
  return {
    chat_base_url,
    chat_endpoint: chat_endpoint as string,
    ...(typeof chat_model === "string" ? { chat_model } : {}),
    stt_base_url,
    tts_base_url,
    ...(tts_model !== undefined ? { tts_model } : {}),
    ...(tts_voice !== undefined ? { tts_voice } : {}),
    ...(typeof tts_speed === "number" ? { tts_speed } : {}),
  };
}

function validateAvatar(file: string, raw: unknown): AvatarConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const vrm_url = raw.vrm_url;
  if (typeof vrm_url !== "string" || vrm_url.length === 0) {
    throw new ConfigError(file, [`vrm_url은 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(vrm_url)})`]);
  }
  return { vrm_url };
}

function validateEmotionRegistry(file: string, raw: unknown): EmotionRegistry {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  const out: EmotionRegistry = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!EMOTION_IDS.has(id as EmotionId)) {
      issues.push(`${id}: 알 수 없는 emotion id (contract §1 enum 외)`);
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
    // contract §2: priority 0~100. typeof number는 NaN/Infinity를 통과시키므로 범위까지 본다.
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
    out[id] = {
      vrma_path: entry.vrma_path as string,
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

function validateEmotionTtsPrefix(file: string, raw: unknown): EmotionTtsPrefixConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  if (typeof raw._version !== "string") issues.push("_version은 문자열이어야 함");
  if (typeof raw._status !== "string") issues.push("_status는 문자열이어야 함");
  // prefixes는 optional — 있으면 string map인지만 확인(값은 발명하지 않는다, 통과만).
  let prefixes: EmotionTtsPrefixConfig["prefixes"];
  if (raw.prefixes !== undefined) {
    if (!isObject(raw.prefixes)) {
      issues.push("prefixes는 객체여야 함");
    } else {
      for (const [id, v] of Object.entries(raw.prefixes)) {
        if (typeof v !== "string") issues.push(`prefixes.${id}는 문자열이어야 함`);
      }
      prefixes = raw.prefixes as EmotionTtsPrefixConfig["prefixes"];
    }
  }
  assertValid(file, issues);
  return {
    _version: raw._version as string,
    _status: raw._status as string,
    ...(prefixes ? { prefixes } : {}),
  };
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
  const [endpointsRaw, avatarRaw, emotionRegistryRaw, emotionTtsPrefixRaw, motionsRaw] =
    await Promise.all([
      read(CONFIG_FILES.endpoints),
      read(CONFIG_FILES.avatar),
      read(CONFIG_FILES.emotionRegistry),
      read(CONFIG_FILES.emotionTtsPrefix),
      read(CONFIG_FILES.motions),
    ]);

  return {
    endpoints: validateEndpoints(CONFIG_FILES.endpoints, endpointsRaw),
    avatar: validateAvatar(CONFIG_FILES.avatar, avatarRaw),
    emotionRegistry: validateEmotionRegistry(CONFIG_FILES.emotionRegistry, emotionRegistryRaw),
    emotionTtsPrefix: validateEmotionTtsPrefix(CONFIG_FILES.emotionTtsPrefix, emotionTtsPrefixRaw),
    motions: validateMotions(CONFIG_FILES.motions, motionsRaw),
  };
}
