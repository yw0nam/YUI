import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { VoiceInputState } from "../../io/voice/stt-vad";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";

/**
 * Voice toggle (this window → main STT) and voice state reflection (main → this window).
 * Component drives local voiceInputStatus, so send changes to main, receive actual STT state and reflect.
 * `applyRemote` seeds a state with the echo suppressed — the quick-card open request uses it.
 */
export function wireVoiceMirror(deps: {
  voiceInputStatus: VoiceInputStatus;
  bridge: Pick<SettingsBridge, "emitVoiceSet" | "onVoiceState">;
}): { applyRemote(state: VoiceInputState): void; dispose(): void } {
  const { voiceInputStatus, bridge } = deps;
  let applyingRemoteVoice = false;
  const applyRemote = (state: VoiceInputState): void => {
    applyingRemoteVoice = true;
    try {
      voiceInputStatus.set(state);
    } finally {
      applyingRemoteVoice = false;
    }
  };
  const unsubscribeLocal = voiceInputStatus.subscribe((snap) => {
    if (!applyingRemoteVoice) bridge.emitVoiceSet(snap.state !== "idle");
  });
  const unsubscribeRemote = bridge.onVoiceState((s) => {
    applyRemote(s.state);
  });
  return {
    applyRemote,
    dispose() {
      unsubscribeLocal();
      unsubscribeRemote();
    },
  };
}
