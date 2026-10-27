import { createLogger } from "../../../logger";

const log = createLogger("unified-voice");

/** Main's speech while the unified chat window shows: the text goes to that window, and the user starting to speak has that window answer like its stop button. */
export function createUnifiedVoice(deps: {
  shown: { get(): boolean };
  bargeIn: () => boolean;
  /** Sends a recognized segment to the unified chat window. */
  sendSegment: (text: string) => void;
  /** Submits a recognized segment on this window's own bus. */
  submitHere: (text: string) => void;
  /** Tells the unified chat window the user started speaking. */
  emitSpeechOnset: () => void;
}): {
  segment(text: string): void;
  speechActive(): void;
} {
  return {
    segment(text) {
      if (deps.shown.get()) {
        log.info("segment_to_unified");
        deps.sendSegment(text);
      } else {
        deps.submitHere(text);
      }
    },
    speechActive() {
      if (!deps.shown.get() || !deps.bargeIn()) return;
      deps.emitSpeechOnset();
      log.info("barge_in_all");
    },
  };
}
