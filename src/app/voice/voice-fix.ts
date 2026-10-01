/**
 * The desktop's voice fix: the pill's "setup needed" tap opens the Connection settings, then hands
 * the pill back to the live listening state.
 */

import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";

export function createVoiceFix(deps: {
  openConnection: () => void;
  status: Pick<VoiceInputStatus, "set">;
}): () => void {
  return () => {
    deps.openConnection();
    deps.status.set("listening");
  };
}
