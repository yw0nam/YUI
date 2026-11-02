/**
 * The desktop's voice fix: the pill's "setup needed" tap opens the First conversation page, then
 * hands the pill back to the live listening state.
 */

import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";

export function createVoiceFix(deps: {
  openSetup: () => void;
  status: Pick<VoiceInputStatus, "set">;
}): () => void {
  return () => {
    deps.openSetup();
    deps.status.set("listening");
  };
}
