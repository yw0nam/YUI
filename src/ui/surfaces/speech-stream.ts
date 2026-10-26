import type { SpeechStream } from "../../io/bridge/settings-bridge";
import type { Surfaces } from "./surfaces";

export function createSpeechStream(deps: {
  presetId: string;
  emit(event: SpeechStream): void;
}): Pick<Surfaces, "beginSpeech" | "pushSpeech" | "endSpeech"> {
  const preset = deps.presetId;
  return {
    beginSpeech(identity) {
      if (identity) deps.emit({ preset, turn_id: identity.turn_id, op: "begin" });
    },
    pushSpeech(delta, identity) {
      if (identity) deps.emit({ preset, turn_id: identity.turn_id, op: "push", delta });
    },
    endSpeech(_opts, identity) {
      if (identity) deps.emit({ preset, turn_id: identity.turn_id, op: "end" });
    },
  };
}
