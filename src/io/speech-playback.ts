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
  /** Base options injected when building the pipeline (synth, sink, …). onAmplitude/onPlaybackEnd are overridden here. */
  pipeline: Omit<TtsPipelineOptions, "onAmplitude" | "onPlaybackEnd" | "onCuePlay">;
  /** Pipeline factory injection for tests. */
  createPipeline?: (opts: TtsPipelineOptions) => TtsPipeline;
  /** Called after stopMouth/finishSpeech/easeEmotionToNeutral on each playback-end. */
  onPlaybackEnd?: () => void;
  /** A backend utterance opened. Client-side phrases (speakAside) never report. */
  onUtteranceStart?: () => void;
  /** The backend utterance opened by the last onUtteranceStart closed. Exactly one per start. */
  onUtteranceEnd?: (ended: "complete" | "interrupted") => void;
  /** Reports whether the pipeline still owes audio. Called after every state change that can flip it. */
  reportAudioOwed?: (owed: boolean) => void;
  /** An ambient stroll is moving the window — a cue-less beat leaves the walk clip alone. */
  isStrolling: () => boolean;
}

export interface SpeechPlayback {
  /** One speech-text unit (streaming token): accumulate into the bubble + drive TTS playback. Opens the bubble on the first token. */
  onSpeechDelta(delta: string): void;
  /** Speech end: defer the bubble dwell + flush the pipeline. no-op if there were no deltas. */
  onSpeechEnd(): void;
  /** One speech-text unit (whole): sugar for onSpeechDelta + onSpeechEnd. */
  onSpeech(text: string): void;
  /** One client-side phrase (thinking filler, failure): spoken like onSpeech, never tracked as backend speech. */
  speakAside(text: string): void;
  /** Forwards a per-beat cue to the pipeline. */
  setCue(cue: ExpressArgs | null): void;
  /**
   * While held (true), null-cue applyCue suppresses playMotion(null) so an externally
   * started looping motion (e.g. thinking) is not reset by cue-less filler sentences.
   * easeEmotionToNeutral still fires — only the motion reset is suppressed.
   */
  holdMotion(held: boolean): void;
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
  // Real audio reached the speakers during the current utterance; cleared on playback-end/interrupt/abort.
  let heardAudio = false;
  let muted = false;
  // The utterance between its first delta and end(); `tracked` marks backend speech.
  let open: { tracked: boolean } | null = null;
  // One entry per end() whose playback boundary has not fired yet — mirrors the pipeline's boundary queue.
  const queued: boolean[] = [];
  // The current mute window already reported its cut-off backend utterance. Clears with `muted`.
  let mutedReported = false;

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
      if (!motionHeld && !options.isStrolling()) renderer.playMotion(null);
    }
  }

  function buildPipeline(): TtsPipeline {
    return factory({
      ...options.pipeline,
      onAmplitude: (rms) => {
        // Fires only when real audio plays (synth-failed/TTS-off sentences don't reach here).
        heardAudio = true;
        renderer.setMouthOpen(rms);
      },
      onCuePlay: (cue) => applyCue(cue),
      onPlaybackEnd: () => {
        renderer.stopMouth();
        surfaces.finishSpeech();
        // When speech ends, the expression also slowly returns to neutral — so the previous emotion isn't trapped forever.
        renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
        heardAudio = false;
        if (queued.shift() === true) options.onUtteranceEnd?.("complete");
        options.onPlaybackEnd?.();
        reportAudioOwed();
      },
    });
  }

  let pipeline = buildPipeline();
  const stripper = createEmojiStripper();

  // Reports the tracked utterance the caller is about to cut, then drops the whole queue —
  // the disposed pipeline never fires the boundaries it held.
  function closeTracked(): boolean {
    const tracked = open?.tracked === true || queued.includes(true);
    open = null;
    queued.length = 0;
    if (tracked) options.onUtteranceEnd?.("interrupted");
    return tracked;
  }

  // Single call site for the reporting expression — every state change that can flip it calls this.
  function reportAudioOwed(): void {
    options.reportAudioOwed?.(pipeline.hasOutstandingWork());
  }

  function delta(text: string, tracked: boolean): void {
    const clean = stripper.push(text);
    if (open === null) {
      surfaces.beginSpeech();
      // A muted remainder still shows in the bubble, and stays out of the record.
      open = { tracked: tracked && !muted };
      if (open.tracked) {
        options.onUtteranceStart?.();
      } else if (tracked && !mutedReported) {
        // The barge-in landed before the answer began: the user talked over all of it.
        mutedReported = true;
        options.onUtteranceStart?.();
        options.onUtteranceEnd?.("interrupted");
      }
    }
    surfaces.pushSpeech(clean);
    if (!muted) pipeline.pushTextDelta(clean);
    reportAudioOwed();
  }

  function end(): void {
    muted = false;
    mutedReported = false;
    if (open === null) return;
    // flush held-back emoji carry (discards it — it's all emoji).
    stripper.flush();
    // Keep the bubble until playback ends — onPlaybackEnd releases it via finishSpeech.
    surfaces.endSpeech({ defer: true });
    // Queued before end(), which fires the boundary inline when nothing was submitted.
    queued.push(open.tracked);
    open = null;
    pipeline.end();
    reportAudioOwed();
  }

  return {
    onSpeechDelta(text) {
      delta(text, true);
    },
    onSpeechEnd() {
      end();
    },
    onSpeech(text) {
      delta(text, true);
      end();
    },
    speakAside(text) {
      delta(text, false);
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
    interrupt(opts) {
      stripper.reset();
      pipeline.dispose();
      pipeline = buildPipeline();
      // Release the held bubble immediately (not deferred).
      surfaces.endSpeech();
      const reported = closeTracked();
      // Also runs as routine pre-turn cleanup when nothing was speaking — only ease if it cut off real audio.
      if (heardAudio) renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      heardAudio = false;
      muted = opts?.muteCurrentTurn === true;
      mutedReported = muted && reported;
      reportAudioOwed();
    },
    abort() {
      stripper.reset();
      // Abnormal end: dispose the pipeline + release the held bubble immediately. No rebuild, as there's no next turn.
      pipeline.dispose();
      surfaces.endSpeech();
      closeTracked();
      // Terminal like onPlaybackEnd — no next turn to re-assert an expression, so always ease.
      renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      heardAudio = false;
      muted = false;
      mutedReported = false;
      reportAudioOwed();
    },
    dispose() {
      pipeline.dispose();
    },
  };
}
