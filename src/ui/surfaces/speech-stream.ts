import type { SpeechStream } from "../../io/bridge/settings-bridge";
import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import type { SpeechSurfaces } from "./surfaces";

export function createSpeechStream(deps: {
  presetId: string;
  emit(event: SpeechStream): void;
  readTranscript(): readonly ChatHistoryEntry[];
}): SpeechSurfaces {
  const preset = deps.presetId;
  return {
    beginSpeech(identity) {
      if (identity) {
        const baseline = deps
          .readTranscript()
          .filter(
            (entry) => entry.role === "assistant" && entry.turn_id === identity.turn_id,
          ).length;
        deps.emit({ preset, turn_id: identity.turn_id, op: "begin", baseline });
      }
    },
    pushSpeech(delta, identity) {
      if (identity) deps.emit({ preset, turn_id: identity.turn_id, op: "push", delta });
    },
    endSpeech(_opts, identity) {
      if (identity) deps.emit({ preset, turn_id: identity.turn_id, op: "end" });
    },
  };
}
