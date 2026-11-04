/**
 * Whether the pet's TTS server answers: one shared voice-list refetch for a voice that is not
 * resolved yet, the reach it and each synth report, and the Reconnect check.
 */

import type { ServerCheck } from "../../../io/chat/models/server-check";
import type { VoiceListOutcome } from "../../../io/voice/voices/voice-list-refresh";

export type TtsReach = "ok" | "unreachable";

const noAnswer = (kind: string): boolean => kind === "unreachable" || kind === "timeout";

export function createTtsReach(deps: {
  refreshVoiceList: () => Promise<VoiceListOutcome>;
  checkTtsServer: () => Promise<ServerCheck | null>;
}): {
  /** One refetch shared by its callers; a failed one is reused until clear(). */
  listRetry(): Promise<VoiceListOutcome>;
  clear(): void;
  report(reach: TtsReach): void;
  /** Checks the server again; resolves whether it answered. */
  reconnect(): Promise<boolean>;
  onReach(cb: (reach: TtsReach) => void): () => void;
} {
  const listeners = new Set<(reach: TtsReach) => void>();
  const report = (reach: TtsReach): void => {
    for (const cb of [...listeners]) cb(reach);
  };
  let retry: Promise<VoiceListOutcome> | undefined;
  return {
    listRetry() {
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
    },
    clear() {
      retry = undefined;
    },
    report,
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
