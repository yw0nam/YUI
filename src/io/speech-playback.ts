/**
 * TTS 재생 ↔ 렌더러 입 모양 ↔ 말풍선 수명을 잇는 글루.
 *
 * 세 반쪽을 연결한다:
 *  - tts-pipeline onAmplitude → renderer.setMouthOpen  (입이 TTS 음량을 따라감)
 *  - tts-pipeline onPlaybackEnd → renderer.stopMouth + surfaces.finishSpeech + ease emotion → neutral
 *  - onSpeechDelta/onSpeechEnd → 말풍선(페이드 보류) 스트리밍 + 파이프라인 구동
 *
 * 말풍선은 endSpeech({ defer:true })로 보류되고, 재생이 끝나(onPlaybackEnd) finishSpeech()로만
 * dwell→페이드된다. 오디오가 한 번도 재생되지 않는 턴(TTS 비활성/빈 텍스트/전부 실패)에도
 * 파이프라인이 onPlaybackEnd를 발화하므로 말풍선이 영영 갇히지 않는다.
 *
 * interrupt()는 현재 파이프라인을 폐기하고 새로 만들며, 보류 중인 말풍선을 즉시(non-defer) 해제한다.
 */

import type { ControlEnvelope, EmotionId, ExpressArgs } from "../contract";
import { createTtsPipeline, type TtsPipeline, type TtsPipelineOptions } from "./tts-pipeline";

/** 발화 종료 후 표정을 neutral로 되돌리는 ease 시간(ms) — 느리게(스냅 X). */
const EMOTION_REVERT_MS = 1000;

interface PlaybackRenderer {
  setMouthOpen(value: number): void;
  stopMouth(): void;
  /** 직전 emotion을 neutral로 천천히 ease (턴 종료 시 표정이 영영 갇히지 않게). */
  easeEmotionToNeutral(durationMs?: number): void;
  applyDirective(env: ControlEnvelope): void;
  playMotion(motion: { id: string } | null): void;
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
  pipeline?: Omit<TtsPipelineOptions, "onAmplitude" | "onPlaybackEnd" | "onCuePlay">;
  /** 테스트용 파이프라인 팩토리 주입. */
  createPipeline?: (opts: TtsPipelineOptions) => TtsPipeline;
}

export interface SpeechPlayback {
  /** 발화 텍스트 1건(스트리밍 토큰): 말풍선 누적 + TTS 재생 구동. 첫 토큰에 말풍선을 연다. */
  onSpeechDelta(delta: string): void;
  /** 발화 종료: 말풍선 dwell 보류 + 파이프라인 flush. delta가 없었다면 no-op. */
  onSpeechEnd(): void;
  /** 발화 텍스트 1건(전체): onSpeechDelta + onSpeechEnd 슈가. */
  onSpeech(text: string): void;
  /** per-beat cue를 파이프라인에 전달. */
  setCue(cue: ExpressArgs | null): void;
  /** 진행 중인 발화를 중단: 파이프라인 폐기·재생성 + 보류 말풍선 즉시 해제. */
  interrupt(): void;
  /** 비정상 종료(에러/네트워크 끊김) 정리: 파이프라인 폐기 + 보류 말풍선 즉시 해제. 다음 턴이 없어 재생성하지 않는다. */
  abort(): void;
  dispose(): void;
}

export function createSpeechPlayback(options: SpeechPlaybackOptions): SpeechPlayback {
  const { renderer, surfaces } = options;
  const factory = options.createPipeline ?? createTtsPipeline;

  // fires when a sentence begins playback or its synth fails — audio-timed expression seam.
  function applyCue(cue: ExpressArgs | null): void {
    if (cue?.emotion_id || cue?.motion_id) {
      renderer.applyDirective({
        speech_text: "",
        ...(cue.emotion_id ? { emotion: { id: cue.emotion_id as EmotionId } } : {}),
        ...(cue.motion_id ? { motion: { id: cue.motion_id } } : {}),
      });
    } else {
      renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      renderer.playMotion(null);
    }
  }

  function buildPipeline(): TtsPipeline {
    return factory({
      ...options.pipeline,
      onAmplitude: (rms) => renderer.setMouthOpen(rms),
      onCuePlay: (cue) => applyCue(cue),
      onPlaybackEnd: () => {
        renderer.stopMouth();
        surfaces.finishSpeech();
        // 발화가 끝나면 표정도 함께 neutral로 천천히 회귀 — 직전 emotion이 영영 갇히지 않게.
        renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      },
    });
  }

  let pipeline = buildPipeline();
  // 직전 begin/interrupt 이후 delta가 1건 이상 들어왔는가.
  let started = false;

  function delta(text: string): void {
    if (!started) {
      surfaces.beginSpeech();
      started = true;
    }
    surfaces.pushSpeech(text);
    pipeline.pushTextDelta(text);
  }

  function end(): void {
    if (!started) return;
    // 재생이 끝날 때까지 말풍선 유지 — onPlaybackEnd가 finishSpeech로 해제한다.
    surfaces.endSpeech({ defer: true });
    pipeline.end();
    started = false;
  }

  return {
    onSpeechDelta(text) {
      delta(text);
    },
    onSpeechEnd() {
      end();
    },
    onSpeech(text) {
      delta(text);
      end();
    },
    setCue(cue) {
      pipeline.setCue(cue);
    },
    interrupt() {
      pipeline.dispose();
      pipeline = buildPipeline();
      // 보류 중이던 말풍선을 즉시 해제 (defer 아님).
      surfaces.endSpeech();
      started = false;
    },
    abort() {
      // 비정상 종료: 파이프라인 폐기 + 보류 말풍선 즉시 해제. 다음 턴이 없어 재생성하지 않는다.
      pipeline.dispose();
      surfaces.endSpeech();
      started = false;
    },
    dispose() {
      pipeline.dispose();
    },
  };
}
