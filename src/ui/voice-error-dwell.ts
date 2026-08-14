/**
 * How long a voice-turn failure holds the indicator's error state.
 *
 * Transient failures clear quickly so the chip does not sit red. A settings-fixable
 * one holds far longer, because its chip carries a fix affordance that must not
 * vanish mid-reach — but it still expires: that chip is registered interactive, so
 * an unattended one would keep taking OS clicks meant for what sits behind YUI.
 */

import { isSettingsFixable } from "./turn-error";
import type { VoiceInputStatus } from "./voice-input-status";

export const VOICE_TURN_ERROR_DISPLAY_MS = 3_000;
export const VOICE_TURN_FIX_HOLD_MS = 60_000;

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
      const holdMs = isSettingsFixable(reason)
        ? VOICE_TURN_FIX_HOLD_MS
        : VOICE_TURN_ERROR_DISPLAY_MS;
      timer = setTimeout(() => {
        timer = null;
        // Only revert what is still the error we posted; the user may have moved on.
        if (status.get().state === "error") status.set("listening");
      }, holdMs);
    },

    dispose: cancel,
  };
}
