/**
 * 발화 텍스트를 문장 분절 → per-sentence TTS → submission index 순서로 재생한다.
 * synth는 동시 실행되고 응답 순서가 뒤바뀌어도 제출 순서대로만 재생된다.
 */

import type { EndpointsConfig } from "../contract";
import { createLogger, type Logger } from "../logger";
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
  // 마지막 청크 재생이 끝나면(또는 재생할 청크가 없으면) end() 이후 1회 발화.
  onPlaybackEnd?: () => void;
  // synth 동시 실행 상한. 기본 1 = 직렬.
  maxInflight?: number;
  logger?: Logger;
}

export interface TtsPipeline {
  pushTextDelta(token: string): void;
  setEmotionText(text: string | null): void;
  end(): void;
  dispose(): void;
}

export function createTtsPipeline(options: TtsPipelineOptions): TtsPipeline {
  const log: Logger = options.logger ?? createLogger("tts-pipeline");
  const synth: TtsSynth =
    options.synth ??
    (() => {
      if (!options.config) {
        throw new Error("[tts-pipeline] config 또는 synth 중 하나는 필요하다");
      }
      return createTtsSynth({ config: options.config, fetch: options.fetch });
    })();
  const sink: AudioSink = options.sink ?? createWebAudioSink();
  const maxInflight = Math.max(1, Math.floor(options.maxInflight ?? 1));

  const segmenter = createSentenceSegmenter();
  const abort = new AbortController();

  let emotionText: string | null = null;
  let disposed = false;

  const results = new Map<number, ArrayBuffer>();
  const failed = new Set<number>();
  const pending: Array<{ index: number; input: string }> = [];
  let inFlight = 0;
  let submitted = 0;
  let nextToPlay = 0;
  let pumping = false;
  let ended = false;
  let completionFired = false;

  // end()된 뒤 큐가 완전히 비면(재생할 청크 없음) 1회만 onPlaybackEnd 발화.
  // 청크 재생 중에는 nextToPlay가 이미 증가했더라도 pump가 await 중이라 호출되지 않는다.
  function maybeFireComplete(): void {
    if (disposed || completionFired) return;
    if (!ended || pumping) return;
    if (nextToPlay !== submitted) return;
    completionFired = true;
    log.info("playback", { state: "complete", segments: submitted });
    options.onPlaybackEnd?.();
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
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
        const idx = nextToPlay;
        nextToPlay++;
        try {
          log.debug("playback", { index: idx, state: "start" });
          let peak = 0;
          const onAmp = (v: number) => {
            if (v > peak) peak = v;
            options.onAmplitude?.(v);
          };
          await sink.play(wav, onAmp);
          log.debug("playback", { index: idx, state: "end", peak_mouth: peak });
        } catch (err) {
          if (disposed) break;
          log.error("playback", { index: idx, error: String(err) });
        }
      }
    } finally {
      pumping = false;
    }
    maybeFireComplete();
  }

  // 큐에 쌓인 항목을 cap 내에서만 synth로 dispatch한다.
  function drainSynth(): void {
    while (inFlight < maxInflight && pending.length > 0) {
      const { index, input } = pending.shift()!;
      inFlight++;
      synth(input, abort.signal).then(
        (wav) => {
          inFlight--;
          if (disposed) return;
          log.debug("synth", { index, ok: true, bytes: wav.byteLength });
          results.set(index, wav);
          drainSynth();
          void pump();
        },
        (err) => {
          inFlight--;
          if (disposed || abort.signal.aborted) return;
          log.error("synth", { index, error: String(err) });
          failed.add(index);
          drainSynth();
          void pump();
        },
      );
    }
  }

  function submit(sentence: string): void {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    const input = emotionText ? `${emotionText} ${trimmed}` : trimmed;
    const index = submitted++;
    log.debug("synth", { index, chars: trimmed.length });
    pending.push({ index, input });
    drainSynth();
  }

  return {
    pushTextDelta(token) {
      if (disposed) return;
      // 완료 발화 후 새 텍스트가 오면 다음 턴 — 완료 사이클을 리셋한다.
      if (ended || completionFired) {
        ended = false;
        completionFired = false;
      }
      for (const sentence of segmenter.push(token)) submit(sentence);
    },

    setEmotionText(text) {
      emotionText = text && text.trim() ? text : null;
    },

    end() {
      if (disposed) return;
      const rest = segmenter.flush();
      if (rest) submit(rest);
      ended = true;
      // 재생할 청크가 하나도 없으면(빈 입력/전부 실패) 여기서 즉시 완료 발화.
      maybeFireComplete();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      sink.stop();
      results.clear();
      failed.clear();
      pending.length = 0;
    },
  };
}
