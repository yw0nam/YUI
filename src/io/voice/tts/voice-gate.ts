import { createExclusiveHold, type ExclusiveHold } from "../../locks/exclusive-hold";

/** One voice at a time across windows: an exclusive Web Lock held from an utterance's first sound to its end. */
const VOICE_LOCK_NAME = "yui.speaking";

export type VoiceGate = ExclusiveHold;

export function createVoiceGate(deps: {
  enabled: () => boolean;
  locks?: Pick<LockManager, "request">;
}): VoiceGate {
  return createExclusiveHold({ name: VOICE_LOCK_NAME, ...deps });
}
