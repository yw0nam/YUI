/**
 * How long a voice-turn failure holds the indicator's error state.
 *
 * Transient failures self-clear back to listening so the chip does not sit red
 * forever. A settings-fixable one holds instead: it is not transient, and its chip
 * carries the fix affordance, which must stay reachable until the user acts on it.
 */

import { isSettingsFixable } from "./turn-error";
import type { VoiceInputStatus } from "./voice-input-status";

export const VOICE_TURN_ERROR_DISPLAY_MS = 3_000;

export interface VoiceErrorDwell {
  show(reason: string): void;
  dispose(): void;
}

export function createVoiceErrorDwell(status: VoiceInputStatus): VoiceErrorDwell {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    show(reason) {
      cancel();
      status.set("error", reason);
      if (isSettingsFixable(reason)) return;
      timer = setTimeout(() => {
        timer = null;
        // Only revert what is still the error we posted; the user may have moved on.
        if (status.get().state === "error") status.set("listening");
      }, VOICE_TURN_ERROR_DISPLAY_MS);
    },

    dispose: cancel,
  };
}
