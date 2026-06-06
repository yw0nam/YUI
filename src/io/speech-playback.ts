/**
 * TTS 재생 ↔ 렌더러 입 모양 ↔ 말풍선 수명을 잇는 글루.
 *
 * 세 반쪽을 연결한다:
 *  - tts-pipeline onAmplitude → renderer.setMouthOpen  (입이 TTS 음량을 따라감)
 *  - tts-pipeline onPlaybackEnd → renderer.stopMouth + surfaces.finishSpeech + ease emotion → neutral
 *  - onSpeech(text) → 말풍선(페이드 보류) + 파이프라인 구동
 *
 * 말풍선은 endSpeech({ defer:true })로 보류되고, 재생이 끝나(onPlaybackEnd) finishSpeech()로만
 * dwell→페이드된다. 오디오가 한 번도 재생되지 않는 턴(TTS 비활성/빈 텍스트/전부 실패)에도
 * 파이프라인이 onPlaybackEnd를 발화하므로 말풍선이 영영 갇히지 않는다.
 */

import { createTtsPipeline, type TtsPipeline, type TtsPipelineOptions } from "./tts-pipeline";

/** 발화 종료 후 표정을 neutral로 되돌리는 ease 시간(ms) — 느리게(스냅 X). */
const EMOTION_REVERT_MS = 1000;

interface PlaybackRenderer {
  setMouthOpen(value: number): void;
  stopMouth(): void;
  /** 직전 emotion을 neutral로 천천히 ease (턴 종료 시 표정이 영영 갇히지 않게). */
  easeEmotionToNeutral(durationMs?: number): void;
}

interface PlaybackSurfaces {
  beginSpeech(): void;
  pushSpeech(delta: string): void;
  endSpeech(opts?: { defer?: boolean }): void;
  finishSpeech(): void;
}

export interface SpeechPlaybackOptions {
  renderer: PlaybackRenderer;
  surfaces: PlaybackSurfaces;
  /** 파이프라인 생성 시 주입할 base 옵션(synth/config 등). onAmplitude/onPlaybackEnd는 여기서 덮어쓴다. */
  pipeline?: Omit<TtsPipelineOptions, "onAmplitude" | "onPlaybackEnd">;
  /** 테스트용 파이프라인 팩토리 주입. */
  createPipeline?: (opts: TtsPipelineOptions) => TtsPipeline;
}

export interface SpeechPlayback {
  /** 발화 텍스트 1건: 말풍선 표시(페이드 보류) + TTS 재생 구동. */
  onSpeech(text: string): void;
  dispose(): void;
}

export function createSpeechPlayback(options: SpeechPlaybackOptions): SpeechPlayback {
  const { renderer, surfaces } = options;
  const factory = options.createPipeline ?? createTtsPipeline;

  const pipeline = factory({
    ...options.pipeline,
    onAmplitude: (rms) => renderer.setMouthOpen(rms),
    onPlaybackEnd: () => {
      renderer.stopMouth();
      surfaces.finishSpeech();
      // 발화가 끝나면 표정도 함께 neutral로 천천히 회귀 — 직전 emotion이 영영 갇히지 않게.
      renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
    },
  });

  return {
    onSpeech(text) {
      surfaces.beginSpeech();
      surfaces.pushSpeech(text);
      // 재생이 끝날 때까지 말풍선 유지 — onPlaybackEnd가 finishSpeech로 해제한다.
      surfaces.endSpeech({ defer: true });
      pipeline.pushTextDelta(text);
      pipeline.end();
    },
    dispose() {
      pipeline.dispose();
    },
  };
}
