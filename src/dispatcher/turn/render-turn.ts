/**
 * render-turn — plays a backend turn that arrived as `render` and `speech` frames on the push socket.
 *
 * The backend pushed it rather than answering a stream, so each frame arrives whole and each
 * segment renders in order. A segment's cues merge into one, because the cue channel carries a
 * single pending cue: a later cue overrides the same field, an empty one overrides nothing.
 *
 * A frame never cuts the speech already playing — it queues behind it, and the pipeline plays the
 * queue in order. Speech stops on what the user does, so a frame of a turn the user stopped is
 * dropped whole: nothing spoken, nothing rendered, nothing recorded.
 *
 * Where the cue goes depends on the segment. With speech it rides the TTS pipeline, which applies it
 * as the audio starts. Without speech there is no audio to wait for and the pipeline would hold it
 * forever, so it goes out as a silent cue, which renders once no thinking motion holds the body.
 * A silent segment waits on the next playback boundary too whenever speech is still owed, whether
 * this frame queued it or an earlier one did, so it doesn't override the expression of audio still
 * playing. That boundary is the pipeline's and not the frame's: every waiting cue fires at the next
 * one playback reaches, which for a frame still being synthesised is before its own speech.
 * Firing ≠ judgment holds here too: a silent segment still renders its expression and motion.
 *
 * `speech` frames carry a reply sentence by sentence while the backend still writes it. They open
 * one utterance that the turn's next `render` closes, so the reply plays and lands in the transcript
 * as one. A cut leaves that utterance to the interruption that made it, since `end()` would clear
 * the barge-in mute.
 */

import type { ExpressArgs } from "../../contract";
import type { ChatHistoryEntry } from "../../io/chat/chat-history-store";
import type { RenderFrame, RenderSegment, SpeechFrame } from "../../io/chat/push-socket";
import { isSilenceToken } from "../../io/chat/silence-token";
import { buildRenderRecord, type RenderRecord } from "../../io/chat/turn-record-log";
import { createLogger, type Logger } from "../../logger";
import { PRE_SPEECH_TIMEOUT_MS } from "../backend/idle-watchdog";
import type { PushTurns } from "./push-turn";
import type { TurnOutput } from "./turn-output";

const baseLog = createLogger("render-turn");

export interface RenderTurnDeps {
  turnOutput: TurnOutput;
  /** Which push turns the user stopped — a frame of one of them never plays. */
  pushTurns: Pick<PushTurns, "rendered" | "isCut" | "cutCount">;
  /** Conversation transcript — the reply half of a push turn lands here. */
  appendTranscript?: (entry: ChatHistoryEntry) => void;
  appendTurnRecord?: (record: RenderRecord) => void;
  logger?: Logger;
}

export interface RenderTurn {
  /** False when the frame belonged to a turn the user stopped — none of it played. */
  render(frame: RenderFrame): boolean;
  /** Plays a frame into its turn's open utterance, opening one when none is. */
  stream(frame: SpeechFrame): void;
  /** Ends the open utterance; with a turn named, only that turn's. */
  close(turnId?: string): void;
  /** Forgets the open utterance of a cut turn; the interruption owns its playback. */
  drop(turnId: string): void;
  dispose(): void;
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

export function createRenderTurn(deps: RenderTurnDeps): RenderTurn {
  const log = deps.logger ?? baseLog;
  /** The turn whose `speech` frames opened the utterance still waiting to be closed. */
  let open: { turnId: string; said: string[]; timer?: ReturnType<typeof setTimeout> } | null = null;

  function appendTranscript(said: readonly string[]): void {
    if (said.length === 0) return;
    try {
      deps.appendTranscript?.({ role: "assistant", text: said.join(" "), ts: Date.now() });
    } catch (err) {
      log.debug("transcript_append_failed", { error: String(err) });
    }
  }

  /** Takes the open utterance out with its wait stopped, and returns what it said. */
  function takeOpen(): string[] {
    if (open === null) return [];
    clearTimeout(open.timer);
    const { said } = open;
    open = null;
    return said;
  }

  /** Accepts a frame of the turn and plays its segments in order, leaving the utterance open. */
  function play(
    turnId: string,
    segments: readonly RenderSegment[],
  ): { spokeText: boolean; said: string[]; queuedBehind: boolean } {
    const queuedBehind = deps.turnOutput.hasOutstandingSpeech();
    // A barge-in mute outlives the turn it cut, so an accepted frame is what ends the window.
    deps.turnOutput.releaseMute();
    deps.pushTurns.rendered(turnId);

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
          deps.turnOutput.silentCue(cue);
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
    return { spokeText, said, queuedBehind };
  }

  function close(turnId?: string): void {
    if (open === null || (turnId !== undefined && open.turnId !== turnId)) return;
    const said = takeOpen();
    deps.turnOutput.end();
    appendTranscript(said);
  }

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
      if (open !== null && open.turnId !== frame.turn_id) close();
      const { spokeText, said, queuedBehind } = play(frame.turn_id, segments);
      const streamed = open !== null;
      const heard = [...takeOpen(), ...said];
      if (spokeText || streamed) deps.turnOutput.end();

      log.info("render", {
        source: frame.source,
        turn_id: frame.turn_id,
        segments: segments.length,
        spoke_text: spokeText,
        queued_behind: queuedBehind,
      });

      appendTranscript(heard);

      try {
        deps.appendTurnRecord?.(
          buildRenderRecord({
            ts: Date.now(),
            source: frame.source,
            turn_id: frame.turn_id,
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

    stream(frame) {
      const turnId = frame.turn_id;
      const segments = frame.segments ?? [];
      if (deps.pushTurns.isCut(turnId)) {
        log.info("push.speech", {
          turn_id: turnId,
          segments: segments.length,
          dropped: "cut_turn",
          stopped_count: deps.pushTurns.cutCount(),
        });
        return;
      }
      if (open !== null && open.turnId !== turnId) close();
      const { said } = play(turnId, segments);
      if (open === null) open = { turnId, said: [] };
      open.said.push(...said);
      clearTimeout(open.timer);
      open.timer = setTimeout(() => close(turnId), PRE_SPEECH_TIMEOUT_MS);
      log.info("push.speech", { turn_id: turnId, segments: segments.length });
    },

    close,

    drop(turnId) {
      if (open?.turnId !== turnId) return;
      appendTranscript(takeOpen());
    },

    dispose() {
      if (open !== null) clearTimeout(open.timer);
    },
  };
}
