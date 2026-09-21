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

import type { ControlEnvelope, EmotionId, ExpressArgs } from "../../../contract";
import { createEmojiStripper } from "./strip-emoji";
import { createLinkStripper } from "./strip-links";
import {
  createTtsPipeline,
  type SpokenSplit,
  type TtsPipeline,
  type TtsPipelineOptions,
} from "./tts-pipeline";

/** Ease duration (ms) to return the expression to neutral after speech ends — slow (no snap). */
const EMOTION_REVERT_MS = 1000;

/** Two cues as one. A later value wins the field it carries; an empty value never overrides. */
function mergeCues(base: ExpressArgs | null, next: ExpressArgs): ExpressArgs {
  const merged: ExpressArgs = { ...base };
  if (next.emotion_id) merged.emotion_id = next.emotion_id;
  if (next.motion_id) merged.motion_id = next.motion_id;
  return merged;
}

/** The render channels of a cue, in the renderer's shape. The voice channels need audio, so they stay out. */
function directiveOf(cue: ExpressArgs): ControlEnvelope {
  return {
    speech_text: "",
    ...(cue.emotion_id ? { emotion: { id: cue.emotion_id as EmotionId } } : {}),
    ...(cue.motion_id ? { motion: { id: cue.motion_id } } : {}),
  };
}

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
  /** A backend utterance closed: "complete" when a start reaches its playback boundary, or one
   *  "interrupted" folding every queued utterance, with what was heard and what was still owed. */
  onUtteranceEnd?: (ended: "complete" | "interrupted", split?: SpokenSplit) => void;
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
  /**
   * Forwards a per-beat cue to the pipeline. `withSpeech` marks a cue whose own sentence follows
   * it in the same stretch of work, so the motion hold has nothing to protect it from.
   */
  setCue(cue: ExpressArgs | null, options?: { withSpeech?: boolean }): void;
  /** Renders a cue that has no speech of its own, once nothing holds the motion. */
  silentCue(cue: ExpressArgs): void;
  /**
   * While held (true), null-cue applyCue suppresses playMotion(null) so an externally
   * started looping motion (e.g. thinking) is not reset by cue-less filler sentences.
   * easeEmotionToNeutral still fires — only the motion reset is suppressed.
   * Returns whether the release (false) applied a motion of its own, which the caller must keep
   * instead of returning the body to idle.
   */
  holdMotion(held: boolean): boolean;
  /** Interrupts an in-progress utterance: dispose/rebuild the pipeline + release the held bubble immediately. */
  interrupt(opts?: { muteCurrentTurn?: boolean }): void;
  /** Ends a barge-in mute window, so the next reply is spoken and not only shown in the bubble. */
  releaseMute(): void;
  /** Whether audio is still owed — speech the backend started on its own included. */
  hasOutstandingSpeech(): boolean;
  /** Cleanup on abnormal end (error/network drop): dispose the pipeline + release the held bubble immediately. No rebuild, as there's no next turn. */
  abort(): void;
  /** Registers a one-shot callback for the next playback-end boundary — a caller sequencing its own work behind whatever speech is already queued. */
  onQueueDrained(callback: () => void): void;
  dispose(): void;
}

export function createSpeechPlayback(options: SpeechPlaybackOptions): SpeechPlayback {
  const { renderer, surfaces } = options;
  const factory = options.createPipeline ?? createTtsPipeline;

  let motionHeld = false;
  let heldCue: ExpressArgs | null = null;
  // The latest speechless cue that arrived while the motion was held — applied on release.
  let heldSilentCue: ExpressArgs | null = null;
  // Real audio reached the speakers during the current utterance; cleared on playback-end/interrupt/abort.
  let heardAudio = false;
  let muted = false;
  // The utterance between its first delta and end(); `tracked` marks backend speech.
  let open: { tracked: boolean } | null = null;
  // One entry per end() whose playback boundary has not fired yet — mirrors the pipeline's boundary queue.
  const queued: boolean[] = [];
  // The current mute window already reported its cut-off backend utterance. Clears with `muted`.
  let mutedReported = false;
  // Callbacks waiting for the next playback-end boundary — drained and cleared each time it fires.
  let drainedCallbacks: Array<() => void> = [];

  // fires when a sentence begins playback or its synth fails — audio-timed expression seam.
  function applyCue(cue: ExpressArgs | null): void {
    if (cue?.emotion_id || cue?.motion_id) {
      renderer.applyDirective(directiveOf(cue));
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
        const callbacks = drainedCallbacks;
        drainedCallbacks = [];
        for (const callback of callbacks) callback();
      },
    });
  }

  let pipeline = buildPipeline();
  const stripper = createEmojiStripper();
  const links = createLinkStripper();

  // Reports the tracked utterance the caller is about to cut, then drops the whole queue —
  // the disposed pipeline never fires the boundaries it held.
  function closeTracked(split: SpokenSplit): boolean {
    const tracked = open?.tracked === true || queued.includes(true);
    open = null;
    queued.length = 0;
    if (tracked) options.onUtteranceEnd?.("interrupted", split);
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
    if (!muted) pipeline.pushTextDelta(links.push(clean), tracked);
    reportAudioOwed();
  }

  function end(): void {
    // a held-back `[…` that never became a link is still spoken.
    const tail = links.flush();
    if (tail) pipeline.pushTextDelta(tail, open?.tracked === true);
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
    setCue(cue, options) {
      if (muted) return;
      if (motionHeld && !options?.withSpeech) {
        heldCue = cue;
      } else {
        pipeline.setCue(cue);
      }
    },
    silentCue(cue) {
      // Segments of one frame park together, the way a segment's own cues merge before they arrive.
      if (motionHeld) heldSilentCue = mergeCues(heldSilentCue, cue);
      else renderer.applyDirective(directiveOf(cue));
    },
    holdMotion(held) {
      if (held) {
        motionHeld = true;
        heldCue = null;
        // A new hold belongs to a newer turn — the cue parked under the old one is superseded.
        heldSilentCue = null;
        return false;
      }
      motionHeld = false;
      if (heldCue !== null) {
        pipeline.setCue(heldCue);
        heldCue = null;
      }
      const silent = heldSilentCue;
      heldSilentCue = null;
      if (silent === null) return false;
      renderer.applyDirective(directiveOf(silent));
      // An empty motion is no motion — directiveOf leaves the channel out for it.
      return Boolean(silent.motion_id);
    },
    interrupt(opts) {
      stripper.reset();
      links.reset();
      // Read before the dispose below — a disposed pipeline reports nothing.
      const split = pipeline.spokenSplit();
      pipeline.dispose();
      pipeline = buildPipeline();
      // The disposed pipeline never fires its boundary — a callback still waiting on it would
      // otherwise fire on whatever drains next, applying a now-superseded turn's cue.
      drainedCallbacks = [];
      heldSilentCue = null;
      // Release the held bubble immediately (not deferred).
      surfaces.endSpeech();
      const reported = closeTracked(split);
      // Also runs as routine pre-turn cleanup when nothing was speaking — only ease if it cut off real audio.
      if (heardAudio) renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      heardAudio = false;
      muted = opts?.muteCurrentTurn === true;
      mutedReported = muted && reported;
      reportAudioOwed();
    },
    abort() {
      stripper.reset();
      links.reset();
      const split = pipeline.spokenSplit();
      // Abnormal end: dispose the pipeline + release the held bubble immediately. No rebuild, as there's no next turn.
      pipeline.dispose();
      // No next turn to drain them, and nothing here should still speak.
      drainedCallbacks = [];
      heldSilentCue = null;
      surfaces.endSpeech();
      closeTracked(split);
      // Terminal like onPlaybackEnd — no next turn to re-assert an expression, so always ease.
      renderer.easeEmotionToNeutral(EMOTION_REVERT_MS);
      heardAudio = false;
      muted = false;
      mutedReported = false;
      reportAudioOwed();
    },
    releaseMute() {
      muted = false;
      mutedReported = false;
    },
    hasOutstandingSpeech() {
      return pipeline.hasOutstandingWork();
    },
    onQueueDrained(callback) {
      drainedCallbacks.push(callback);
    },
    dispose() {
      pipeline.dispose();
      drainedCallbacks = [];
    },
  };
}
