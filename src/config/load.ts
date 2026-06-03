/**
 * Config loader — configs/*.json 로더. (placeholder, PRD F8 / concept.md §2.F)
 *
 * config-driven 원칙(concept.md §1): API 엔드포인트 / 모델 / VRM 경로 / 모션셋을 하드코딩하지 않는다.
 * OSS 단계에서 API 키는 평문 config 대신 OS keychain(Tauri secure storage)로 — concept.md §2.F.
 *
 * 로드 대상(YUI 루트 configs/):
 *  - endpoints.json         → EndpointsConfig (chat/stt/tts base url)
 *  - emotion_registry.json  → EmotionRegistry (emotion id → vrm_expression + fallback)
 *  - emotion_tts_prefix.json→ emotion id → TTS prefix (현재 TBD 스텁, 발명 금지)
 *  - motions.json           → MotionRegistry (id → vrma_path + 재생 정책)
 *
 * 지금은 시그니처/타입만. 실제 로드(fetch 또는 Tauri fs) + 핫리로드는 M1.
 */

import type {
  EmotionId,
  EmotionRegistry,
  EndpointsConfig,
  MotionRegistry,
} from "../contract";

/** emotion_tts_prefix.json 형태 — TBD 스텁(contract.md §1, D-EMOTION-DUAL). 토큰 발명 금지. */
export interface EmotionTtsPrefixConfig {
  _version: string;
  _status: string;
  /** enum별 prefix는 TTS 구현 시 사용자 확정 후 채운다. */
  prefixes?: Partial<Record<EmotionId, string>>;
}

/** 로드된 전체 config 묶음. */
export interface AppConfig {
  endpoints: EndpointsConfig;
  emotionRegistry: EmotionRegistry;
  emotionTtsPrefix: EmotionTtsPrefixConfig;
  motions: MotionRegistry;
}

/**
 * configs/*.json 전체 로드 (placeholder).
 * TODO(M1): YUI 루트 configs/에서 4개 json 로드 + 스키마 검증 + 핫리로드 watcher.
 */
export async function loadConfig(): Promise<AppConfig> {
  // TODO(M1): 실제 로드. 현재는 호출 시 명시적으로 미구현 신호.
  throw new Error("loadConfig: not implemented (M1) — configs/*.json 로더 미구현");
}
