/** The Ask slot's two cards: the queue's head shows on the card of its kind, and the other hides. */

import type { AskSlotAnswer, AskSlotFrame } from "../../io/chat/tools/run/settings-request-frame";
import { createSettingsRequestCard } from "../settings-request/settings-request-card";
import { createAskCard } from "./ask-card";

export function createSlotCards(deps: { mount: HTMLElement }): {
  set(frames: AskSlotFrame[]): void;
  onAnswer(cb: (answer: AskSlotAnswer) => boolean): void;
  dispose(): void;
} {
  const askCard = createAskCard(deps);
  const settingsCard = createSettingsRequestCard(deps);
  return {
    set(frames) {
      const head = frames[0];
      askCard.set(head?.type === "ask" ? [head] : []);
      settingsCard.set(head?.type === "settings_request" ? head : undefined);
    },
    onAnswer(cb) {
      askCard.onAnswer(cb);
      settingsCard.onDecision(cb);
    },
    dispose() {
      askCard.dispose();
      settingsCard.dispose();
    },
  };
}
