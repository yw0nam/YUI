/**
 * render-turn — plays a finished backend turn that arrived as a `render` frame on the push socket.
 *
 * The backend pushed it rather than answering a stream, so the whole reply is already in hand and
 * each segment renders in order. A segment's cues merge into one, because the cue channel carries a
 * single pending cue: a later cue overrides the same field, an empty one overrides nothing.
 *
 * A frame never cuts the speech already playing — it queues behind it, and the pipeline plays the
 * queue in order. Speech stops on what the user does, so a frame of a turn the user stopped is
 * dropped whole: nothing spoken, nothing rendered, nothing recorded.
 *
 * Where the cue goes depends on the segment. With speech it rides the TTS pipeline, which applies it
 * as the audio starts. Without speech there is no audio to wait for and the pipeline would hold it
 * forever, so it goes straight to the renderer — the path a silent streamed turn already takes. A
 * silent segment waits on the next playback boundary instead whenever speech is still owed, whether
 * this frame queued it or an earlier one did, so it doesn't override the expression of audio still
 * playing. That boundary is the pipeline's and not the frame's: every waiting cue fires at the next
 * one playback reaches, which for a frame still being synthesised is before its own speech.
 * Firing ≠ judgment holds here too: a silent segment still renders its expression and motion.
 */

import type { ControlEnvelope, EmotionId, ExpressArgs } from "../contract";
import type { ChatHistoryEntry } from "../io/chat-history-store";
import type { RenderFrame } from "../io/push-socket";
import { isSilenceToken } from "../io/silence-token";
import { buildRenderRecord, type RenderRecord } from "../io/turn-record-log";
import { createLogger, type Logger } from "../logger";
import type { Renderer } from "../renderer";
import type { PushTurns } from "./push-turn";
import type { TurnOutput } from "./turn-output";

const baseLog = createLogger("render-turn");

export interface RenderTurnDeps {
  turnOutput: TurnOutput;
  /** Which push turns the user stopped — a frame of one of them never plays. */
  pushTurns: Pick<PushTurns, "rendered" | "isCut" | "cutCount">;
  /** Render sink for a cue with no audio behind it. */
  renderer: Pick<Renderer, "applyDirective">;
  /** Conversation transcript — the reply half of a push turn lands here. */
  appendTranscript?: (entry: ChatHistoryEntry) => void;
  appendTurnRecord?: (record: RenderRecord) => void;
  logger?: Logger;
}

export interface RenderTurn {
  /** False when the frame belonged to a turn the user stopped — none of it played. */
  render(frame: RenderFrame): boolean;
}

/** One segment's cues as a single cue. Later values win; an empty value never overrides. */
function mergeCues(cues: readonly ExpressArgs[]): ExpressArgs {
  const merged: ExpressArgs = {};
  for (const cue of cues) {
    if (cue.emotion_id) merged.emotion_id = cue.emotion_id;
    if (cue.motion_id) merged.motion_id = cue.motion_id;
    if (cue.emotion_text) merged.emotion_text = cue.emotion_text;
    if (cue.caption) merged.caption = cue.caption;
  }
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

export function createRenderTurn(deps: RenderTurnDeps): RenderTurn {
  const log = deps.logger ?? baseLog;

  return {
    render(frame) {
      const segments = frame.segments ?? [];
      if (deps.pushTurns.isCut(frame.turn_id)) {
        log.info("render", {
          source: frame.source,
          turn_id: frame.turn_id,
          segments: segments.length,
          dropped: "cut_turn",
          stopped_count: deps.pushTurns.cutCount(),
        });
        return false;
      }
      const queuedBehind = deps.turnOutput.hasOutstandingSpeech();
      // A barge-in mute outlives the turn it cut, so an accepted frame is what ends the window.
      deps.turnOutput.releaseMute();
      deps.pushTurns.rendered(frame.turn_id);

      let spokeText = false;
      const said: string[] = [];
      for (const segment of segments) {
        const cue = mergeCues(segment.cues ?? []);
        const speech = segment.speech ?? "";
        const speaks = Boolean(speech.trim()) && !isSilenceToken(speech);

        if (speaks) {
          if (Object.keys(cue).length > 0) deps.turnOutput.cueWithSpeech(cue);
          // The newline is a sentence boundary to the segmenter, so a segment that ends without a
          // terminator still closes here instead of running into the next segment and its cue.
          deps.turnOutput.delta(`${speech}\n`);
          said.push(speech.trim());
          spokeText = true;
          continue;
        }
        if (!cue.emotion_id && !cue.motion_id) continue;
        const applyCue = (): void => {
          try {
            deps.renderer.applyDirective(directiveOf(cue));
          } catch (err) {
            // The renderer owns its own fallback; a failed cue must not cost the rest of the render.
            log.error("silent_cue.render_error", { error: String(err) });
          }
        };
        // Speech is still queued on the pipeline — wait for a playback boundary so this cue does
        // not override the expression of audio that is still playing.
        if (spokeText || queuedBehind) {
          deps.turnOutput.onQueueDrained(applyCue);
        } else {
          applyCue();
        }
      }
      if (spokeText) deps.turnOutput.end();

      log.info("render", {
        source: frame.source,
        turn_id: frame.turn_id,
        segments: segments.length,
        spoke_text: spokeText,
        queued_behind: queuedBehind,
      });

      if (said.length > 0) {
        try {
          deps.appendTranscript?.({ role: "assistant", text: said.join(" "), ts: Date.now() });
        } catch (err) {
          log.debug("transcript_append_failed", { error: String(err) });
        }
      }

      try {
        deps.appendTurnRecord?.(
          buildRenderRecord({
            ts: Date.now(),
            source: frame.source,
            ...(frame.turn_id !== null ? { turn_id: frame.turn_id } : {}),
            segments: segments.length,
            spoke_text: spokeText,
            queued_behind: queuedBehind,
          }),
        );
      } catch (err) {
        log.debug("turn_record_append_failed", { error: String(err) });
      }
      return true;
    },
  };
}
