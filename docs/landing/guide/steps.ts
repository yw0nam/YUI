import type { readBody } from "../character/body";
import { $ } from "../shared/dom";
export type Step = "intro" | "seat" | "move" | "session" | "done";
let step: Step = "intro",
  stepAt = 0,
  touched = false;
export const currentStep = () => step;
export function announce(text: string) {
  $("live").textContent = text;
}
export function setStep(next: Step, text?: string) {
  step = next;
  stepAt = performance.now();
  touched = false;
  if (text) announce(text);
}
export function noteTouched() {
  touched = true;
}
export function readGuide(now: number) {
  return { step, idle: now - stepAt > 3000 && !touched };
}
export function updateSteps(body: ReturnType<typeof readBody>) {
  if (step === "seat" && body.sitting)
    setStep("move", "She sits on the terminal. Drag the terminal to move it.");
  if (step === "move" && !body.pinned && body.state !== "seating")
    setStep("seat", "Drag her onto the terminal.");
}
export function finishWalk() {
  if (step === "intro") setStep("seat", "Drag her onto the terminal.");
}
