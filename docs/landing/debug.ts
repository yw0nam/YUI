import { proj, readBody } from "./character/body";
import { rHead, rHips, vrm } from "./character/load";
import { readPet } from "./character/overlays";
import { K, LH, LW } from "./desk";
import { coachText } from "./guide/draw";
import { currentStep } from "./guide/steps";
import { readCast } from "./session/cast";
import { readThreadsWindow } from "./session/threads-window";
import { term } from "./shared/dom";
import { rect } from "./shared/math";
import { currentPhase } from "./story";
import { readTerminal } from "./terminal";
import { isSpeaking } from "./voice";

declare global {
  interface Window {
    __yuiLanding: typeof landingState;
  }
}
const landingState = () => ({
  speaking: isSpeaking(),
  aa: vrm.expressionManager?.getValue("aa") ?? 0,
  phase: currentPhase(),
  step: currentStep(),
  state: readBody().state,
  pinned: readBody().pinned,
  hips: proj(rHips),
  head: proj(rHead),
  term: rect(term),
  target: readTerminal().target,
  pet: readPet(),
  K,
  LW,
  LH,
  castT: readCast().castT,
  playing: readCast().playing,
  ...readThreadsWindow(),
  coach: coachText(),
});
window.__yuiLanding = landingState;
