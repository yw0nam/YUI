/**
 * Segments speech text into sentences → per-sentence TTS → plays in submission-index order.
 * synths run concurrently, but playback stays in submission order even if responses arrive out of order.
 */

import type { ExpressArgs } from "../../contract";
import { createLogger, type Logger } from "../../logger";
import { type AudioSink, createWebAudioSink } from "./audio-player";
import { createSentenceSegmenter } from "./sentence-segmenter";
import type { TtsSynth } from "./tts-synth";

/** When synth rejects with this value it's a silent skip — takes the failed-skip path with no error log. */
export const TTS_SKIP: unique symbol = Symbol("TTS_SKIP");

export interface TtsPipelineOptions {
  synth: TtsSynth;
  sink?: AudioSink;
  onAmplitude?: (rms: number) => void;
  // Fires once after end() when the last chunk finishes playing (or when there are no chunks to play).
  onPlaybackEnd?: () => void;
  // Fires once when each sentence starts playing (or on synth-failure skip). null = no cue for this sentence.
  onCuePlay?: (cue: ExpressArgs | null) => void;
  // Fires when a sentence's synth rejects for real (TTS_SKIP does not count) — the synth request failed.
  onSynthFailure?: () => void;
  // Concurrent-synth cap. Default 1 = serial. The function form is evaluated per drain, reading config lazily.
  maxInflight?: number | (() => number);
  logger?: Logger;
}

/** What the listener heard of the tracked text, and what was still owed when it was cut. */
export interface SpokenSplit {
  spoken: string;
  unspoken: string;
}

export interface TtsPipeline {
  /** `tracked` marks backend speech; client-side phrases push it false. */
  pushTextDelta(token: string, tracked: boolean): void;
  setCue(cue: ExpressArgs | null): void;
  end(): void;
  dispose(): void;
  /** True whenever the pipeline still owes audio playback (submitted-not-played, or a chunk mid-play). */
  hasOutstandingWork(): boolean;
  /** The tracked text split at what playback reached. Read it before dispose(); after, both halves are empty. */
  spokenSplit(): SpokenSplit;
}

export function createTtsPipeline(options: TtsPipelineOptions): TtsPipeline {
  const log: Logger = options.logger ?? createLogger("tts-pipeline");
  const synth: TtsSynth = options.synth;
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
  // One entry per submitted sentence, in index order, until its completion boundary fires.
  const entries = new Map<number, { text: string; tracked: boolean; played: boolean }>();
  // The flag of the most recent push — it owns whatever is still sitting in the segmenter.
  let tailTracked = false;
  const failed = new Set<number>();
  const cues = new Map<number, ExpressArgs | null>();
  const pending: Array<{ index: number; input: string; caption?: string }> = [];
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
      const boundary = pendingCompletions.shift()!;
      // A finished utterance is reported complete, so it is no longer what a later interrupt cut.
      for (const index of entries.keys()) if (index < boundary) entries.delete(index);
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
        const entry = entries.get(idx);
        if (entry) entry.played = true;
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
      const { index, input, caption } = pending.shift()!;
      inFlight++;
      synth(input, abort.signal, caption ? { caption } : undefined).then(
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
            // Before pump, so a listener that suppresses rescheduling wins over this index's onPlaybackEnd.
            options.onSynthFailure?.();
          }
          failed.add(index);
          drainSynth();
          void pump();
        },
      );
    }
  }

  function submit(sentence: string, tracked: boolean): void {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    const cue = pendingCue;
    pendingCue = null;
    const voiceTag = cue?.emotion_text?.trim() || null;
    const input = voiceTag ? `${voiceTag} ${trimmed}` : trimmed;
    // The caption is a direction for the voice, not words to speak — it rides beside the input.
    const caption = cue?.caption?.trim() || undefined;
    const index = submitted++;
    cues.set(index, cue);
    entries.set(index, { text: trimmed, tracked, played: false });
    log.debug("synth", { index, chars: trimmed.length });
    pending.push({ index, input, ...(caption ? { caption } : {}) });
    drainSynth();
  }

  return {
    hasOutstandingWork() {
      return !disposed && (submitted > nextToPlay || pumping);
    },

    pushTextDelta(token, tracked) {
      if (disposed) return;
      tailTracked = tracked;
      for (const sentence of segmenter.push(token)) submit(sentence, tracked);
    },

    spokenSplit() {
      if (disposed) return { spoken: "", unspoken: "" };
      const spoken: string[] = [];
      const unspoken: string[] = [];
      // What is still owed starts after the last sentence playback began: a sentence the listener
      // heard past — one whose synth failed — was no longer owed, whether or not it made a sound.
      let lastPlayed = -1;
      for (const [index, entry] of entries) if (entry.played) lastPlayed = index;
      for (const [index, entry] of entries) {
        if (!entry.tracked) continue;
        if (entry.played) spoken.push(entry.text);
        else if (index > lastPlayed) unspoken.push(entry.text);
      }
      const tail = segmenter.peek();
      if (tail && tailTracked) unspoken.push(tail);
      return { spoken: spoken.join(" "), unspoken: unspoken.join(" ") };
    },

    setCue(cue) {
      if (!cue) {
        pendingCue = null;
        return;
      }
      const emotText = cue.emotion_text?.trim() ? cue.emotion_text : undefined;
      const caption = cue.caption?.trim() ? cue.caption : undefined;
      pendingCue =
        (cue.emotion_id ?? cue.motion_id ?? emotText ?? caption)
          ? { ...cue, emotion_text: emotText, caption }
          : null;
    },

    end() {
      if (disposed) return;
      const rest = segmenter.flush();
      if (rest) submit(rest, tailTracked);
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
      entries.clear();
      pending.length = 0;
      pendingCompletions.length = 0;
    },
  };
}
