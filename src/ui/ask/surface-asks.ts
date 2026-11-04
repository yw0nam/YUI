import type { AskAnswer } from "../../io/chat/push/push-frames";
import { createAskCard } from "./ask-card";

export function createSurfaceAsks(mount: HTMLElement) {
  let answer: (value: AskAnswer) => boolean = () => false;
  const card = createAskCard({ mount, onAnswer: (value) => answer(value) });
  return {
    ...card,
    onAnswer(cb: (value: AskAnswer) => boolean): void {
      answer = cb;
    },
  };
}
