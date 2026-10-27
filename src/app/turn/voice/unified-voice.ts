import { createLogger } from "../../../logger";

const log = createLogger("unified-voice");

/** Main's speech while the unified chat window shows: the text goes to that window, and the user starting to speak stops every window. */
export function createUnifiedVoice(deps: {
  shown: { get(): boolean };
  bargeIn: () => boolean;
  /** Sends a recognized segment to the unified chat window. */
  sendSegment: (text: string) => void;
  /** Submits a recognized segment on this window's own bus. */
  submitHere: (text: string) => void;
  emitStopTurns: () => void;
}): {
  segment(text: string): void;
  speechActive(): void;
  /** This window's stop path, run on a barge-in that stops every window. */
  onStop(cb: () => void): () => void;
} {
  const stops = new Set<() => void>();
  return {
    segment(text) {
      if (deps.shown.get()) deps.sendSegment(text);
      else deps.submitHere(text);
    },
    speechActive() {
      if (!deps.shown.get() || !deps.bargeIn()) return;
      // A window's own emit never reaches itself, so this window stops on its own.
      deps.emitStopTurns();
      for (const cb of [...stops]) cb();
      log.info("barge_in_all");
    },
    onStop(cb) {
      stops.add(cb);
      return () => stops.delete(cb);
    },
  };
}
