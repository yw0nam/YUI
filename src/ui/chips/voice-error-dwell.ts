/**
 * How long a voice-turn failure holds the status pill's voice error state. The failure clears
 * quickly so the mic does not sit red; its condition and action live on the pill's notice.
 */

import type { VoiceInputStatus } from "./voice-input-status";

export const VOICE_TURN_ERROR_DISPLAY_MS = 3_000;

interface VoiceErrorDwell {
  show(reason: string, message?: string): void;
  dispose(): void;
}

/**
 * With a host that owns capture intent the hold ends where the host wants the mic (listening or
 * idle); without one it ends listening.
 */
export function createVoiceErrorDwell(
  status: VoiceInputStatus,
  host?: { wanted(): boolean },
): VoiceErrorDwell {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    show(reason, message) {
      cancel();
      status.set("error", reason, message);
      timer = setTimeout(() => {
        timer = null;
        // Only revert what is still the error we posted; the user may have moved on.
        if (status.get().state === "error") {
          status.set(host === undefined || host.wanted() ? "listening" : "idle");
        }
      }, VOICE_TURN_ERROR_DISPLAY_MS);
    },

    dispose: cancel,
  };
}
