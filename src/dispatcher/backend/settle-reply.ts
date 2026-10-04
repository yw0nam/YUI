/** Settles a finished reply: renders its directive, routes its cue, applies the speech gate, and reports whether it spoke. */
import type { ControlEnvelope } from "../../contract";
import { isSilenceToken } from "../../io/chat/silence-token";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { PushCallDeps } from "./push-call";

/** The subset of `createBackendCaller`'s deps that settling a reply reads. */
export interface SettleDeps extends Pick<PushCallDeps, "turnOutput" | "reportSpokeText"> {
  /** render directive sink (applyDirective). */
  renderer: Pick<Renderer, "applyDirective">;
}

export interface SettleArgs {
  envelope: ControlEnvelope;
  /** Post-flush value. */
  streamedAny: boolean;
  cueStreamed: boolean;
  /** Read only when the `empty_speech` log fields are built. */
  getEventName: () => string;
}

export interface ReplySettler {
  /** Runs the settle effects in order and returns whether the turn spoke text. */
  settle(args: SettleArgs): boolean;
}

export function createReplySettler(deps: SettleDeps, log: Logger): ReplySettler {
  function settle(args: SettleArgs): boolean {
    const { envelope, streamedAny, cueStreamed } = args;

    // B5 (render half): when per-beat cue streamed and speech present (streamedAny), TTS pipeline
    //   applies cue audio-timed at sentence playback — don't double-apply here.
    //   Otherwise (no cue, or cue but silent turn), apply once at completed:
    //   firing≠judgment — silent-turn-with-cue still renders emotion/motion,
    //   and completed-only backend without express streaming is preserved.
    //   An envelope carrying neither channel renders nothing: expression and motion stay as they are.
    const pipelineOwnsCues = cueStreamed && streamedAny;
    const carriesChannel = "emotion" in envelope || "motion" in envelope;
    if (pipelineOwnsCues || !carriesChannel) {
      log.debug("dispatch_to_renderer", {
        owner: pipelineOwnsCues ? "pipeline" : "none",
        emotion: envelope.emotion ?? null,
        motion: envelope.motion ?? null,
      });
    } else {
      try {
        deps.renderer.applyDirective(envelope);
        log.debug("dispatch_to_renderer", {
          owner: "completed",
          emotion: envelope.emotion ?? null,
          motion: envelope.motion ?? null,
        });
      } catch (err) {
        // Renderer error → ambient fallback is renderer's responsibility, dispatcher continues.
        log.error("dispatch_to_renderer.error", { error: String(err) });
      }
    }

    // Completed path only: no per-beat cue carried the voice channels, so route them through
    // the same cue channel here — emotion_id/motion_id omitted, applyDirective above already
    // rendered them and re-sending would double-apply.
    if (!streamedAny && (envelope.emotion_text != null || envelope.caption != null)) {
      deps.turnOutput?.cue({
        ...(envelope.emotion_text != null ? { emotion_text: envelope.emotion_text } : {}),
        ...(envelope.caption != null ? { caption: envelope.caption } : {}),
      });
    }

    // B4 (speech gate): speak only when speech_text has non-whitespace text and is not the [SILENT] token.
    //   Whitespace-only text or a bare [SILENT] = silence — no separate flag/decision, no failure outcome.
    const silentToken = isSilenceToken(envelope.speech_text);
    if (streamedAny) {
      // Streaming path: delta already drove speech, only signal end (don't call speak).
      deps.turnOutput?.end();
      log.debug("speech", { text: envelope.speech_text });
    } else if (envelope.speech_text?.trim() && !silentToken) {
      // Legacy fallback: backend that only provides completed without delta.
      deps.turnOutput?.speak(envelope.speech_text);
      log.debug("speech", { text: envelope.speech_text });
    } else {
      log.info("empty_speech", { trigger: args.getEventName() });
    }
    const spokeText = streamedAny || (Boolean(envelope.speech_text?.trim()) && !silentToken);
    deps.reportSpokeText?.(spokeText);
    return spokeText;
  }

  return { settle };
}
