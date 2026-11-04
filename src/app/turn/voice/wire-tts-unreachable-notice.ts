/**
 * wireTtsUnreachableNotice — a reply that went voiceless because the voice server did not answer
 * offers "Reconnect" under its bubble when that reply ends, once per outage; an "ok" reach ends the
 * outage. Reconnect checks the server again without replaying the reply: the action reads busy
 * while the check runs, leaves when the server answers, and returns when it does not. The greeting
 * and a reply while the unified chat window is shown are skipped, as for the synth-failure notice.
 */

import type { UtteranceIdentity } from "../../../contract";
import type { Surfaces } from "../../../ui/surfaces/surfaces";

export function wireTtsUnreachableNotice(deps: {
  onTtsReach: (cb: (reach: "ok" | "unreachable") => void) => () => void;
  onUtteranceStart: (cb: () => void) => () => void;
  onUtteranceEnd: (cb: (identity: UtteranceIdentity) => void) => () => void;
  reconnect: () => Promise<boolean>;
  surfaces: Pick<Surfaces, "showSpeechActions">;
  isUnifiedShown: () => boolean;
  t: (key: string) => string;
}): { dispose: () => void } {
  // An unreachable reach arrived during the playing utterance.
  let voiceless = false;
  // The action was shown during this outage.
  let offered = false;
  // New speech started while a Reconnect check ran; it already cleared the actions.
  let started = false;

  const offer = (): void =>
    deps.surfaces.showSpeechActions([
      { label: deps.t("voice.unreachable_action"), onClick: () => void reconnectClick() },
    ]);

  async function reconnectClick(): Promise<void> {
    started = false;
    deps.surfaces.showSpeechActions([
      { label: deps.t("svc.chat_status_connecting"), busy: true, onClick: () => {} },
    ]);
    const reached = await deps.reconnect();
    if (started) return;
    if (reached) deps.surfaces.showSpeechActions([]);
    else offer();
  }

  const unsubscribeReach = deps.onTtsReach((reach) => {
    if (reach === "unreachable") {
      voiceless = true;
      return;
    }
    voiceless = false;
    offered = false;
  });
  const unsubscribeStart = deps.onUtteranceStart(() => {
    started = true;
  });
  const unsubscribeEnd = deps.onUtteranceEnd((identity) => {
    const show =
      voiceless && !offered && identity.event_name !== "greeting" && !deps.isUnifiedShown();
    voiceless = false;
    if (!show) return;
    offered = true;
    offer();
  });
  return {
    dispose: () => {
      unsubscribeReach();
      unsubscribeStart();
      unsubscribeEnd();
    },
  };
}
