/**
 * tts-pipeline.ts — client-side 발화 파이프라인 orchestration (PRD F4 / contract.md §3 D-TTS-PIPELINE).
 *
 * 순서(사용자 확정, contract.md §3):
 *  1. 텍스트 스트림 수신 (response.output_text.delta 토큰) → pushTextDelta.
 *  2. 버퍼 큐 적재 + 3. 문장 분절 → sentence-segmenter(pure).
 *  4. emotion_text prefix 부착 (있을 때만 — opaque free text를 verbatim prepend, 발명 금지).
 *  5. per-sentence TTS 호출 → tts-synth ({tts_base_url}/v1/audio/speech → wav).
 *  6. ordered playback — synth는 동시 실행, 응답 순서가 뒤바뀌어도 submission index 순서로만 재생.
 *  7. 진폭 기반 립싱크 — sink가 onAmplitude(rms)를 콜백(립싱크 wiring 자체는 #15).
 *
 * D-EMOTION(verified): emotion_id→prefix 매핑은 없다. emotion_text는 backend가 주는 자유 텍스트
 *   (예: "[whisper in small voice]")이며, 문장 emit 시점의 값을 snapshot해 "<emotion_text> <문장>"으로
 *   합쳐 보낸다. emotion_text가 null/빈값이면 plain 문장.
 *
 * ordered playback 구현: synth는 던지자마자 동시 실행되고 결과는 results 맵에 index로 쌓인다.
 *   nextToPlay 커서가 가리키는 index의 wav가 준비되면 sink.play를 await하고 커서를 +1 한다.
 *   한 index의 synth가 실패하면 그 index를 skip(커서만 전진)해 큐가 막히지 않게 한다.
 */

import type { EndpointsConfig } from "../contract";
import { createWebAudioSink, type AudioSink } from "./audio-player";
import { createSentenceSegmenter } from "./sentence-segmenter";
import { createTtsSynth, type TtsSynth } from "./tts-synth";

export interface TtsPipelineOptions {
  config: EndpointsConfig;
  /** TTS 합성기 주입(테스트). 미지정 시 createTtsSynth(config, fetch). */
  synth?: TtsSynth;
  /** 오디오 재생 sink 주입(테스트). 미지정 시 createWebAudioSink(). */
  sink?: AudioSink;
  /** synth fetch override(Tauri/dev). synth 미주입 시 createTtsSynth로 전달. */
  fetch?: typeof fetch;
  /** 재생 진폭(rms) 콜백 — 립싱크 hook(#15에서 mouth blendshape로 wiring). */
  onAmplitude?: (rms: number) => void;
}

export interface TtsPipeline {
  /** 텍스트 스트림 토큰 적재 → 완성 문장마다 emotion_text snapshot + index 부여 + synth 동시 시작. */
  pushTextDelta(token: string): void;
  /** 이후 emit되는 분절에 prepend할 free-text prefix 설정/해제. */
  setEmotionText(text: string | null): void;
  /** 스트림 종료 — segmenter 잔여를 마지막 분절로 flush. */
  end(): void;
  /** in-flight synth abort + sink.stop + 상태 정리 (event-dispatcher.md §12 cleanup). */
  dispose(): void;
}

export function createTtsPipeline(options: TtsPipelineOptions): TtsPipeline {
  const synth: TtsSynth =
    options.synth ?? createTtsSynth({ config: options.config, fetch: options.fetch });
  const sink: AudioSink = options.sink ?? createWebAudioSink();

  const segmenter = createSentenceSegmenter();
  const abort = new AbortController();

  let emotionText: string | null = null;
  let disposed = false;

  // index별 synth 결과(준비된 wav). 에러로 skip된 index는 results에 안 들어오고 cursor만 전진.
  const results = new Map<number, ArrayBuffer>();
  const failed = new Set<number>();
  let submitted = 0; // 다음 부여할 index.
  let nextToPlay = 0; // 다음 재생할 index 커서.
  let pumping = false;

  /** 재생 펌프 — nextToPlay가 준비되면 순서대로 재생. 한 번에 하나의 펌프만 돈다. */
  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (!disposed) {
        // 실패한 index는 건너뛴다(큐 deadlock 방지).
        if (failed.has(nextToPlay)) {
          failed.delete(nextToPlay);
          nextToPlay++;
          continue;
        }
        const wav = results.get(nextToPlay);
        if (wav === undefined) break; // 아직 준비 안 됨 — synth 완료가 다시 깨운다.
        results.delete(nextToPlay);
        nextToPlay++;
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
  }

  function submit(sentence: string): void {
    const trimmed = sentence.trim();
    if (!trimmed) return; // 빈/공백 → synth 호출 안 함.
    const input = emotionText ? `${emotionText} ${trimmed}` : trimmed;
    const index = submitted++;

    synth(input, abort.signal).then(
      (wav) => {
        if (disposed) return;
        results.set(index, wav);
        void pump();
      },
      (err) => {
        if (disposed) return;
        if (abort.signal.aborted) return; // dispose로 인한 abort는 조용히.
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
