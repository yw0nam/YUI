/**
 * Glue connecting TTS playback ↔ renderer mouth shape ↔ speech-bubble lifetime.
 *
 * Wires three halves together:
 *  - tts-pipeline onAmplitude → renderer.setMouthOpen  (mouth follows TTS volume)
 *  - tts-pipeline onPlaybackEnd → renderer.stopMouth + surfaces.finishSpeech + ease emotion → neutral
 *  - onSpeechDelta/onSpeechEnd → speech-bubble streaming (fade deferred) + drives the pipeline
 *
 * The bubble is held via endSpeech({ defer:true }) and only dwells→fades once playback ends
 * (onPlaybackEnd) through finishSpeech(). Even on turns where audio never plays (TTS disabled/empty
 * text/all-failed), the pipeline fires onPlaybackEnd, so the bubble is never trapped forever.
 *
 * interrupt() disposes the current pipeline and builds a new one, releasing any held bubble immediately (non-defer).
 */

import type { ControlEnvelope, EmotionId, ExpressArgs } from "../contract";
import { createEmojiStripper } from "./strip-emoji";
import { createTtsPipeline, type TtsPipeline, type TtsPipelineOptions } from "./tts-pipeline";

/** Ease duration (ms) to return the expression to neutral after speech ends — slow (no snap). */
const EMOTION_REVERT_MS = 1000;

interface PlaybackRenderer {
  setMouthOpen(value: number): void;
  stopMouth(): void;
  /** Slowly eases the previous emotion to neutral (so the expression isn't trapped forever at turn end). */
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
  /** Base options injected when building the pipeline (synth/config, etc.). onAmplitude/onPlaybackEnd are overridden here. */
  pipeline?: Omit<TtsPipelineOptions, "onAmplitude" | "onPlaybackEnd" | "onCuePlay">;
  /** Pipeline factory injection for tests. */
  createPipeline?: (opts: TtsPipelineOptions) => TtsPipeline;
  /** Called after stopMouth/finishSpeech/easeEmotionToNeutral on each playback-end. */
  onPlaybackEnd?: () => void;
}

export interface SpeechPlayback {
  /** One speech-text unit (streaming token): accumulate into the bubble + drive TTS playback. Opens the bubble on the first token. */
  onSpeechDelta(delta: string): void;
  /** Speech end: defer the bubble dwell + flush the pipeline. no-op if there were no deltas. */
  onSpeechEnd(): void;
  /** One speech-text unit (whole): sugar for onSpeechDelta + onSpeechEnd. */
  onSpeech(text: string): void;
  /** Forwards a per-beat cue to the pipeline. */
  setCue(cue: ExpressArgs | null): void;
  /**
   * While held (true), null-cue applyCue suppresses playMotion(null) so an externally
   * started looping motion (e.g. thinking) is not reset by cue-less filler sentences.
   * easeEmotionToNeutral still fires — only the motion reset is suppressed.
   */
  holdMotion(held: boolean): void;
  /** Whether audio is owed: playing now, or still queued for a finished reply. False once nothing remains to play. */
  isSpeaking(): boolean;
  /** Interrupts an in-progress utterance: dispose/rebuild the pipeline + release the held bubble immediately. */
  interrupt(opts?: { muteCurrentTurn?: boolean }): void;
  /** Cleanup on abnormal end (error/network drop): dispose the pipeline + release the held bubble immediately. No rebuild, as there's no next turn. */
  abort(): void;
  dispose(): void;
}

export function createSpeechPlayback(options: SpeechPlaybackOptions): SpeechPlayback {
  const { renderer, surfaces } = options;
  const factory = options.createPipeline ?? createTtsPipeline;

  let motionHeld = false;
  let heldCue: ExpressArgs | null = null;
  // TTS-active window: opened by the first played audio frame, closed on playback-end/interrupt/abort.
  let speaking = false;
  let muted = false;

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
      if (!motionHeld) renderer.playMotion(null);
    }
  }

  function buildPipeline(): TtsPipeline {
    return factory({
      ...options.pipeline,
      onAmplitude: (rms) => {
        // Fires only when real audio plays (synth-failed/TTS-off sentences don't reach here) — the true barge-in signal.
        speaking = true;
        renderer.setMouthOpen(rms);
      },
      onCuePlay: (cue) => applyCue(cue),
      onPlaybackEnd: () => {
        renderer.stopMouth();
        surfaces.finishSpeech();
        // When speech ends, the expression also slowly returns to neutral — so the previous emotion isn't trapped forever.
        renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
        speaking = false;
        options.onPlaybackEnd?.();
      },
    });
  }

  let pipeline = buildPipeline();
  // Whether at least one delta has arrived since the last begin/interrupt.
  let started = false;
  const stripper = createEmojiStripper();

  function delta(text: string): void {
    const clean = stripper.push(text);
    if (!started) {
      surfaces.beginSpeech();
      started = true;
    }
    surfaces.pushSpeech(clean);
    if (!muted) pipeline.pushTextDelta(clean);
  }

  function end(): void {
    muted = false;
    if (!started) return;
    // flush held-back emoji carry (discards it — it's all emoji).
    stripper.flush();
    // Keep the bubble until playback ends — onPlaybackEnd releases it via finishSpeech.
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
      if (muted) return;
      if (motionHeld) {
        heldCue = cue;
      } else {
        pipeline.setCue(cue);
      }
    },
    holdMotion(held) {
      if (held) {
        motionHeld = true;
        heldCue = null;
      } else {
        motionHeld = false;
        if (heldCue !== null) {
          pipeline.setCue(heldCue);
          heldCue = null;
        }
      }
    },
    isSpeaking() {
      return speaking || pipeline.hasOutstandingWork();
    },
    interrupt(opts) {
      stripper.reset();
      pipeline.dispose();
      pipeline = buildPipeline();
      // Release the held bubble immediately (not deferred).
      surfaces.endSpeech();
      started = false;
      // Also runs as routine pre-turn cleanup when nothing was speaking — only ease if it cut off real audio.
      if (speaking) renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      speaking = false;
      muted = opts?.muteCurrentTurn === true;
    },
    abort() {
      stripper.reset();
      // Abnormal end: dispose the pipeline + release the held bubble immediately. No rebuild, as there's no next turn.
      pipeline.dispose();
      surfaces.endSpeech();
      started = false;
      // Terminal like onPlaybackEnd — no next turn to re-assert an expression, so always ease.
      renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      speaking = false;
      muted = false;
    },
    dispose() {
      pipeline.dispose();
    },
  };
}
