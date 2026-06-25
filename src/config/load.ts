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

import type { EmotionRegistry, EndpointsConfig, MotionRegistry } from "../contract";
import { resolveAssetUrl } from "../io/asset-url";
import { validateAvatar } from "./validators/avatar";
import { validateEmotionRegistry } from "./validators/emotion-registry";
import { validateEndpoints } from "./validators/endpoints";
import { validateFiller } from "./validators/filler";
import { validateGuardrails } from "./validators/guardrails";
import { validateMotions } from "./validators/motions";
import { ConfigError } from "./validators/shared";
import { validateSources } from "./validators/sources";

export { ConfigError } from "./validators/shared";

/** 논리 경로 → 런타임 URL 변환기. dev = identity, Tauri = 번들 리소스 절대 URL. */
export type AssetUrlResolver = (logicalPath: string) => Promise<string>;

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
  /** "user" = OS 파일 피커로 임포트한 항목, "file" = 설정 파일에 명시된 외부 경로. 미지정 시 미상. */
  source?: "bundled" | "file" | "user";
}

/** configs/avatar.json — 로드할 VRM (렌더러 입력). */
export interface AvatarConfig {
  /** vite dev 정적 서빙 경로(`/vrms/*.vrm`) 또는 절대 URL. 기본 선택. */
  vrm_url: string;
  /** 선택 가능한 VRM 목록. 없으면 vrm_url 단일 모델. */
  available?: AvatarOption[];
  /** 전신 fit-to-bounds 카메라 knob. 없으면 렌더러 기본값. */
  framing?: { margin?: number; fov?: number };
  /** 클릭스루 hit-test knob. 없으면 컨트롤러 기본값. */
  hit_test?: {
    hysteresis_margin_px?: number;
    poll_interval_ms?: number;
    debounce_samples?: number;
    /** phase-2용 alpha 임계(현재 미사용, (0,1] 범위만 검증). */
    alpha_threshold?: number;
  };
  /** 카메라 시선 추적(gaze) knob. 없으면 렌더러 기본값(natural preset). 부분값 허용. */
  gaze?: {
    deadDeg?: number;
    headEngageDeg?: number;
    disengageDeg?: number;
    maxHeadYaw?: number;
    maxHeadPitch?: number;
    eyeMaxDeg?: number;
    headNeckSplit?: number;
    smooth?: number;
  };
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

/** configs/sources.json — present-gated firing source presence knob. */
export interface SourcesConfig {
  proactive: { present_max_idle_ms: number };
  schedule: { present_max_idle_ms: number };
}

/** TTFT filler language — closed union, never crosses the Hermes wire. */
export type FillerLang = "ja" | "en" | "ko";

/** Per-language filler phrase pool split into two tiers. */
export interface FillerPool {
  /** Phrases for the first filler utterance (immediate acknowledgment). */
  first: string[];
  /** Phrases for subsequent filler utterances (still-thinking backchannels). */
  repeat: string[];
}

/** configs/filler.json — TTFT filler phrases + loop timing. */
export interface FillerConfig {
  /** Silence (ms) between filler utterances — base. */
  gap_ms: number;
  /** Random ± jitter (ms) added to gap_ms each repeat. */
  gap_jitter_ms: number;
  /** Per-language filler phrase pools. */
  pools: Partial<Record<FillerLang, FillerPool>>;
}

/** 로드·검증된 전체 config 묶음 (불변 스냅샷). */
export interface AppConfig {
  endpoints: EndpointsConfig;
  avatar: AvatarConfig;
  emotionRegistry: EmotionRegistry;
  motions: MotionRegistry;
  guardrails: GuardrailsConfig;
  sources: SourcesConfig;
  filler: FillerConfig;
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
  filler: "filler.json",
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

/** SecretProvider name for the STT server key (OpenAI-compatible Bearer). */
export const STT_API_KEY_SECRET = "stt_api_key";

/** SecretProvider name for the OpenAI-compatible TTS server key (Bearer). irodori needs none. */
export const TTS_API_KEY_SECRET = "tts_api_key";

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
// reader
// ─────────────────────────────────────────────────────────────────────────────

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
  /** 논리 경로 → 런타임 URL 변환기(주입 가능). 기본은 resolveAssetUrl(dev passthrough / Tauri 번들). */
  resolveUrl?: AssetUrlResolver;
  /** fetch 주입(테스트). 미지정 시 globalThis.fetch. */
  fetch?: typeof fetch;
}

/** fetch 기반 기본 reader (브라우저/Tauri webview 런타임). */
function fetchReader(
  baseUrl: string,
  cacheBust?: string,
  resolveUrl: AssetUrlResolver = resolveAssetUrl,
  fetchImpl: typeof fetch = globalThis.fetch,
): ConfigReader {
  return async (file) => {
    const q = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : "";
    const url = await resolveUrl(`${baseUrl}/${file}${q}`);
    const res = await fetchImpl(url);
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
// loadConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * configs/*.json 전체를 읽어 검증된 AppConfig로 조립한다.
 * 어느 파일이든 누락/스키마 위반이면 ConfigError로 즉시 실패한다(fail-loud, 부분 로드 없음).
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<AppConfig> {
  const read =
    opts.read ??
    fetchReader(opts.baseUrl ?? "/configs", opts.cacheBust, opts.resolveUrl, opts.fetch);

  // 파일별 read는 병렬, 검증은 결정적 순서로.
  const [
    endpointsRaw,
    avatarRaw,
    emotionRegistryRaw,
    motionsRaw,
    guardrailsRaw,
    sourcesRaw,
    fillerRaw,
  ] = await Promise.all([
    read(CONFIG_FILES.endpoints),
    read(CONFIG_FILES.avatar),
    read(CONFIG_FILES.emotionRegistry),
    read(CONFIG_FILES.motions),
    read(CONFIG_FILES.guardrails),
    read(CONFIG_FILES.sources),
    read(CONFIG_FILES.filler),
  ]);

  return {
    endpoints: validateEndpoints(CONFIG_FILES.endpoints, endpointsRaw),
    avatar: validateAvatar(CONFIG_FILES.avatar, avatarRaw),
    emotionRegistry: validateEmotionRegistry(CONFIG_FILES.emotionRegistry, emotionRegistryRaw),
    motions: validateMotions(CONFIG_FILES.motions, motionsRaw),
    guardrails: validateGuardrails(CONFIG_FILES.guardrails, guardrailsRaw),
    sources: validateSources(CONFIG_FILES.sources, sourcesRaw),
    filler: validateFiller(CONFIG_FILES.filler, fillerRaw),
  };
}
