import type { AskSlotAnswer, AskSlotFrame } from "../../io/chat/tools/run/settings-request-frame";

export function createSlotCards(_deps: { mount: HTMLElement }): {
  set(frames: AskSlotFrame[]): void;
  onAnswer(cb: (answer: AskSlotAnswer) => boolean): void;
  dispose(): void;
} {
  return { set() {}, onAnswer() {}, dispose() {} };
}
