import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";

/**
 * Voice toggle (this window → main STT) and voice state reflection (main → this window).
 * Component drives local voiceInputStatus, so send changes to main, receive actual STT state and reflect.
 */
export function wireVoiceMirror(deps: {
  voiceInputStatus: VoiceInputStatus;
  bridge: Pick<SettingsBridge, "emitVoiceSet" | "onVoiceState">;
}): () => void {
  const { voiceInputStatus, bridge } = deps;
  let applyingRemoteVoice = false;
  const unsubscribeLocal = voiceInputStatus.subscribe((snap) => {
    if (!applyingRemoteVoice) bridge.emitVoiceSet(snap.state !== "idle");
  });
  const unsubscribeRemote = bridge.onVoiceState((s) => {
    applyingRemoteVoice = true;
    try {
      voiceInputStatus.set(s.state);
    } finally {
      applyingRemoteVoice = false;
    }
  });
  return () => {
    unsubscribeLocal();
    unsubscribeRemote();
  };
}
