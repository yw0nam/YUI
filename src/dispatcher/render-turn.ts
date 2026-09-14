/**
 * render-turn — plays a finished backend turn that arrived as a `render` frame on the push socket.
 *
 * The backend pushed it rather than answering a stream, so the whole reply is already in hand: each
 * segment's cues go to the same express path a streamed cue takes, then its speech to the same TTS
 * and bubble path, in segment order. A segment whose speech is empty or a bare `[SILENT]` stays
 * quiet while its cues still play — firing ≠ judgment holds here too.
 */

import type { RenderFrame } from "../io/push-socket";
import { isSilenceToken } from "../io/silence-token";
import { buildRenderRecord, type RenderRecord } from "../io/turn-record-log";
import { createLogger, type Logger } from "../logger";
import type { TurnOutput } from "./turn-output";

const baseLog = createLogger("render-turn");

export interface RenderTurnDeps {
  turnOutput: TurnOutput;
  appendTurnRecord?: (record: RenderRecord) => void;
  logger?: Logger;
}

export interface RenderTurn {
  render(frame: RenderFrame): void;
}

export function createRenderTurn(deps: RenderTurnDeps): RenderTurn {
  const log = deps.logger ?? baseLog;

  return {
    render(frame) {
      const segments = frame.segments ?? [];
      deps.turnOutput.interrupt();

      let spokeText = false;
      for (const segment of segments) {
        for (const cue of segment.cues ?? []) deps.turnOutput.cue(cue);
        const speech = segment.speech ?? "";
        if (!speech.trim() || isSilenceToken(speech)) continue;
        deps.turnOutput.delta(speech);
        spokeText = true;
      }
      if (spokeText) deps.turnOutput.end();

      log.info("render", {
        source: frame.source,
        turn_id: frame.turn_id,
        segments: segments.length,
        spoke_text: spokeText,
      });

      try {
        deps.appendTurnRecord?.(
          buildRenderRecord({
            ts: Date.now(),
            source: frame.source,
            ...(frame.turn_id !== null ? { turn_id: frame.turn_id } : {}),
            segments: segments.length,
            spoke_text: spokeText,
          }),
        );
      } catch (err) {
        log.debug("turn_record_append_failed", { error: String(err) });
      }
    },
  };
}
