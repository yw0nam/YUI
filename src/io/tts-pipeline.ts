/**
 * Segments speech text into sentences → per-sentence TTS → plays in submission-index order.
 * synths run concurrently, but playback stays in submission order even if responses arrive out of order.
 */

import type { EndpointsConfig, ExpressArgs } from "../contract";
import { createLogger, type Logger } from "../logger";
import { type AudioSink, createWebAudioSink } from "./audio-player";
import { createSentenceSegmenter } from "./sentence-segmenter";
import { createTtsSynth, type TtsSynth } from "./tts-synth";

/** When synth rejects with this value it's a silent skip — takes the failed-skip path with no error log. */
export const TTS_SKIP: unique symbol = Symbol("TTS_SKIP");

export interface TtsPipelineOptions {
  // Unused when synth is injected. Don't eagerly evaluate a throwable value like config.get() and pass it in.
  config?: EndpointsConfig;
  synth?: TtsSynth;
  sink?: AudioSink;
  fetch?: typeof fetch;
  onAmplitude?: (rms: number) => void;
  // Fires once after end() when the last chunk finishes playing (or when there are no chunks to play).
  onPlaybackEnd?: () => void;
  // Fires once when each sentence starts playing (or on synth-failure skip). null = no cue for this sentence.
  onCuePlay?: (cue: ExpressArgs | null) => void;
  // Concurrent-synth cap. Default 1 = serial. The function form is evaluated per drain, reading config lazily.
  maxInflight?: number | (() => number);
  logger?: Logger;
}

export interface TtsPipeline {
  pushTextDelta(token: string): void;
  setCue(cue: ExpressArgs | null): void;
  end(): void;
  dispose(): void;
  /** True whenever the pipeline still owes audio playback (submitted-not-played, or a chunk mid-play). */
  hasOutstandingWork(): boolean;
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
  // Evaluated at drain time — the function form reads the hot-reload config value each time.
  const resolveMaxInflight = (): number => {
    const v =
      typeof options.maxInflight === "function" ? options.maxInflight() : options.maxInflight;
    // ?? 1 does not catch NaN; non-finite (NaN/±Infinity) would hang or unbound the drain.
    const n = Math.floor(v ?? 1);
    return Number.isFinite(n) ? Math.max(1, n) : 1;
  };

  const segmenter = createSentenceSegmenter();
  const abort = new AbortController();

  let pendingCue: ExpressArgs | null = null;
  let disposed = false;

  const results = new Map<number, ArrayBuffer>();
  const failed = new Set<number>();
  const cues = new Map<number, ExpressArgs | null>();
  const pending: Array<{ index: number; input: string }> = [];
  let inFlight = 0;
  let submitted = 0;
  let nextToPlay = 0;
  let pumping = false;
  // Submitted-count boundaries queued by end() calls not yet fully played. A new turn's
  // pushTextDelta can submit more segments before an earlier turn's boundary is reached,
  // so boundaries are tracked independently — each fires onPlaybackEnd exactly once, in order.
  const pendingCompletions: number[] = [];

  // Once playback catches up to a queued boundary (no chunk still playing), fire onPlaybackEnd
  // for it. While a chunk is playing this isn't called — pump is awaiting sink.play.
  function maybeFireComplete(): void {
    if (disposed || pumping) return;
    while (pendingCompletions.length > 0 && nextToPlay >= pendingCompletions[0]) {
      pendingCompletions.shift();
      log.info("playback", { state: "complete", segments: nextToPlay });
      options.onPlaybackEnd?.();
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (!disposed) {
        if (failed.has(nextToPlay)) {
          const idx = nextToPlay;
          failed.delete(idx);
          options.onCuePlay?.(cues.get(idx) ?? null);
          cues.delete(idx);
          nextToPlay++;
          continue;
        }
        const wav = results.get(nextToPlay);
        if (wav === undefined) break;
        results.delete(nextToPlay);
        const idx = nextToPlay;
        nextToPlay++;
        options.onCuePlay?.(cues.get(idx) ?? null);
        cues.delete(idx);
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

  // Dispatch queued items to synth, but only up to the cap.
  function drainSynth(): void {
    while (inFlight < resolveMaxInflight() && pending.length > 0) {
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
          if (err === TTS_SKIP) {
            log.debug("synth", { index, skip: true });
          } else {
            log.error("synth", { index, error: String(err) });
          }
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
    const cue = pendingCue;
    pendingCue = null;
    const voiceTag = cue?.emotion_text?.trim() || null;
    const input = voiceTag ? `${voiceTag} ${trimmed}` : trimmed;
    const index = submitted++;
    cues.set(index, cue);
    log.debug("synth", { index, chars: trimmed.length });
    pending.push({ index, input });
    drainSynth();
  }

  return {
    hasOutstandingWork() {
      return !disposed && (submitted > nextToPlay || pumping);
    },

    pushTextDelta(token) {
      if (disposed) return;
      for (const sentence of segmenter.push(token)) submit(sentence);
    },

    setCue(cue) {
      if (!cue) {
        pendingCue = null;
        return;
      }
      const emotText = cue.emotion_text?.trim() ? cue.emotion_text : undefined;
      pendingCue =
        (cue.emotion_id ?? cue.motion_id ?? emotText) ? { ...cue, emotion_text: emotText } : null;
    },

    end() {
      if (disposed) return;
      const rest = segmenter.flush();
      if (rest) submit(rest);
      pendingCompletions.push(submitted);
      // If there are no chunks to play at all (empty input / all failed), fire completion immediately here.
      maybeFireComplete();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      sink.stop();
      results.clear();
      failed.clear();
      cues.clear();
      pending.length = 0;
      pendingCompletions.length = 0;
    },
  };
}
