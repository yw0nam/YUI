/**
 * 발화 텍스트를 문장 분절 → per-sentence TTS → submission index 순서로 재생한다.
 * synth는 동시 실행되고 응답 순서가 뒤바뀌어도 제출 순서대로만 재생된다.
 */

import type { EndpointsConfig } from "../contract";
import { createWebAudioSink, type AudioSink } from "./audio-player";
import { createSentenceSegmenter } from "./sentence-segmenter";
import { createTtsSynth, type TtsSynth } from "./tts-synth";

export interface TtsPipelineOptions {
  // synth 주입 시 미사용. config.get()처럼 throw 가능한 값을 eager 평가해 넘기지 말 것.
  config?: EndpointsConfig;
  synth?: TtsSynth;
  sink?: AudioSink;
  fetch?: typeof fetch;
  onAmplitude?: (rms: number) => void;
  /** 큐가 드레인돼 재생이 멎으면 1회 호출 — 립싱크 입 닫기 신호. dispose 시엔 호출 안 함. */
  onPlaybackEnd?: () => void;
}

export interface TtsPipeline {
  pushTextDelta(token: string): void;
  setEmotionText(text: string | null): void;
  end(): void;
  dispose(): void;
}

export function createTtsPipeline(options: TtsPipelineOptions): TtsPipeline {
  const synth: TtsSynth =
    options.synth ??
    (() => {
      if (!options.config) {
        throw new Error("[tts-pipeline] config 또는 synth 중 하나는 필요하다");
      }
      return createTtsSynth({ config: options.config, fetch: options.fetch });
    })();
  const sink: AudioSink = options.sink ?? createWebAudioSink();

  const segmenter = createSentenceSegmenter();
  const abort = new AbortController();

  let emotionText: string | null = null;
  let disposed = false;

  const results = new Map<number, ArrayBuffer>();
  const failed = new Set<number>();
  let submitted = 0;
  let nextToPlay = 0;
  let pumping = false;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    let played = false;
    try {
      while (!disposed) {
        if (failed.has(nextToPlay)) {
          failed.delete(nextToPlay);
          nextToPlay++;
          continue;
        }
        const wav = results.get(nextToPlay);
        if (wav === undefined) break;
        results.delete(nextToPlay);
        nextToPlay++;
        played = true;
        try {
          await sink.play(wav, options.onAmplitude);
        } catch (err) {
          if (disposed) break;
          console.error("[tts-pipeline] playback failed", err);
        }
      }
    } finally {
      pumping = false;
    }
    // 큐가 비어 재생이 멎었고(이 패스에서 실제 재생됨) 폐기되지 않았으면 입을 닫게 알린다.
    if (played && !disposed) options.onPlaybackEnd?.();
  }

  function submit(sentence: string): void {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    const input = emotionText ? `${emotionText} ${trimmed}` : trimmed;
    const index = submitted++;

    synth(input, abort.signal).then(
      (wav) => {
        if (disposed) return;
        results.set(index, wav);
        void pump();
      },
      (err) => {
        if (disposed || abort.signal.aborted) return;
        console.error(`[tts-pipeline] synth failed (index ${index})`, err);
        failed.add(index);
        void pump();
      },
    );
  }

  return {
    pushTextDelta(token) {
      if (disposed) return;
      for (const sentence of segmenter.push(token)) submit(sentence);
    },

    setEmotionText(text) {
      emotionText = text && text.trim() ? text : null;
    },

    end() {
      if (disposed) return;
      const rest = segmenter.flush();
      if (rest) submit(rest);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      sink.stop();
      results.clear();
      failed.clear();
    },
  };
}
