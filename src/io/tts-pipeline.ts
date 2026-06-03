/**
 * TTS pipeline — client-side 발화 파이프라인. (placeholder, PRD F4 / contract.md §3 D-TTS-PIPELINE)
 *
 * 순서(사용자 확정, contract.md §3):
 *  1. 텍스트 스트림 수신 (response.output_text.delta 토큰).
 *  2. 버퍼 큐 적재.
 *  3. 문장 분절(sentence boundary) 감지 → 분절 단위로 끊음. (분절 방식은 구현 시 결정 — 새 리서치 X)
 *  4. emotion prefix 부착 (있을 때만 — emotion optional, 없으면 plain text). configs/emotion_tts_prefix.json (TBD).
 *  5. per-sentence TTS 호출 → {tts_base_url}/audio/speech → output wav.
 *  6. ordered playback — 응답이 뒤바뀌어 와도 원래 문장 순서대로 재생.
 *  7. 진폭 기반 립싱크 동기 — 재생 wav 진폭 → mouth blendshape (renderer로 핸들 전달).
 *
 * ⚠ emotion prefix 토큰/포맷은 TBD — TTS 구현 시 사용자에게 질문해 확정. 발명 금지(D-EMOTION-DUAL).
 *
 * 지금은 시그니처/타입만. 실제 큐/분절/fetch/playback은 M2(E2E)에서 audio life-cycle과 함께.
 */

import type { EmotionId, EndpointsConfig } from "../contract";

export interface TtsPipelineOptions {
  config: EndpointsConfig;
  /** emotion id → TTS text prefix. configs/emotion_tts_prefix.json 로드 결과 (현재 TBD/빈 값). */
  emotionPrefix?: Partial<Record<EmotionId, string>>;
}

export interface TtsPipeline {
  /** 텍스트 스트림 토큰을 큐에 적재 (step 2). */
  pushTextDelta(token: string): void;
  /** 이번 발화에 적용할 현재 emotion (step 4, optional). */
  setEmotion(emotion: EmotionId | null): void;
  /** 스트림 종료 — 큐의 잔여 텍스트를 마지막 분절로 flush. */
  end(): void;
  /** 재생 중지 + 버퍼/오디오 리소스 해제 (event-dispatcher.md §12 cleanup). */
  dispose(): void;
}

/**
 * TTS 파이프라인 인스턴스 생성 (placeholder).
 * TODO(M2): 버퍼 큐 + sentence segmenter + per-sentence fetch + ordered playback + 진폭 립싱크.
 */
export function createTtsPipeline(_options: TtsPipelineOptions): TtsPipeline {
  return {
    pushTextDelta(_token) {
      /* TODO(M2) */
    },
    setEmotion(_emotion) {
      /* TODO(M2) */
    },
    end() {
      /* TODO(M2) */
    },
    dispose() {
      /* TODO(M2) */
    },
  };
}
