/** Whether the pet's TTS server answers: the voice list retry, the reach synths report, and Reconnect. */

import type { ServerCheck } from "../../../io/chat/models/server-check";
import { TtsUnreachableError } from "../../../io/voice/tts/tts-synth";
import type { VoiceListOutcome } from "../../../io/voice/voices/voice-list-refresh";

export type TtsReach = "ok" | "unreachable";

const noAnswer = (kind: string): boolean => kind === "unreachable" || kind === "timeout";

export function createTtsReach(deps: {
  refreshVoiceList: () => Promise<VoiceListOutcome>;
  checkTtsServer: () => Promise<ServerCheck | null>;
}): {
  /** Resolves whether a voice is ready, fetching the voice list once more when a TTS URL is set. */
  ensureSpeaker(isReady: () => boolean, hasUrl: () => boolean): Promise<boolean>;
  /** Drops a failed voice list retry kept for the last utterance. */
  clear(): void;
  report(reach: TtsReach): void;
  /** Reports a synth failure; true when it is the voice's failure, not a server that did not answer. */
  synthFailed(error: unknown): boolean;
  /** Checks the server again; resolves whether it answered. */
  reconnect(): Promise<boolean>;
  onReach(cb: (reach: TtsReach) => void): () => void;
} {
  const listeners = new Set<(reach: TtsReach) => void>();
  const report = (reach: TtsReach): void => {
    for (const cb of [...listeners]) cb(reach);
  };
  let retry: Promise<VoiceListOutcome> | undefined;
  function listRetry(): Promise<VoiceListOutcome> {
    if (retry) return retry;
    const pending = deps.refreshVoiceList().then((outcome) => {
      // skipped: a newer refresh took the answer, so the next caller asks again.
      if ((outcome.kind === "ok" || outcome.kind === "skipped") && retry === pending) {
        retry = undefined;
      }
      if (outcome.kind === "ok") report("ok");
      else if (noAnswer(outcome.kind)) report("unreachable");
      return outcome;
    });
    retry = pending;
    return pending;
  }
  return {
    async ensureSpeaker(isReady, hasUrl) {
      if (isReady()) return true;
      if (!hasUrl()) return false;
      await listRetry();
      return isReady();
    },
    clear() {
      retry = undefined;
    },
    report,
    synthFailed(error) {
      if (!(error instanceof TtsUnreachableError)) return true;
      report("unreachable");
      return false;
    },
    async reconnect() {
      const result = await deps.checkTtsServer();
      retry = undefined;
      const reached = !(result && noAnswer(result.kind));
      report(reached ? "ok" : "unreachable");
      return reached;
    },
    onReach(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
