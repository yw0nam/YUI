/**
 * STT + VAD — 음성 입력 파이프라인. (placeholder, PRD F3 / concept.md §2.C)
 *
 * 책임(M1+):
 *  - VAD(@ricky0123/vad-web, Silero+ONNX Runtime Web, alignment V8)로 발화 시작/끝 감지.
 *  - 발화 종료 시 오디오 세그먼트를 STT 서비스로 전송:
 *    POST {stt_base_url}/audio/transcriptions (OpenAI 호환) → transcript.
 *  - transcript를 user_input_source의 `user.voice_segment_ready`로 dispatcher에 firing
 *    (event-dispatcher.md §3.4).
 *
 * ⚠ @ricky0123/vad-web는 지금 import하지 않는다 (F3에서 사용). dependency만 추가됨.
 *
 * 지금은 시그니처/타입만. 실제 VAD 로드 + STT fetch는 M1.
 */

import type { EndpointsConfig, InputContext } from "../contract";

/** STT 결과. contract.md §4 InputContext.transcript와 동일 형태. */
export type Transcript = NonNullable<InputContext["transcript"]>;

export interface SttVadOptions {
  config: EndpointsConfig;
  /** VAD가 한 발화 세그먼트를 STT까지 마치면 호출. */
  onVoiceSegment: (transcript: Transcript) => void;
}

export interface SttVad {
  /** 마이크 권한 + VAD 로드 후 청취 시작. */
  start(): Promise<void>;
  /** 청취 중지. */
  stop(): void;
  /** VAD 인스턴스 + ONNX 세션 해제. */
  dispose(): void;
}

/**
 * STT+VAD 인스턴스 생성 (placeholder).
 * TODO(M1): @ricky0123/vad-web MicVAD 로드 → onSpeechEnd → /audio/transcriptions POST.
 */
export function createSttVad(_options: SttVadOptions): SttVad {
  return {
    async start() {
      /* TODO(M1) */
    },
    stop() {
      /* TODO(M1) */
    },
    dispose() {
      /* TODO(M1) */
    },
  };
}
