import { bodyState, proj } from "./character/body";
import { rHead, rHips, vrm } from "./character/load";
import { pet } from "./character/overlays";
import { K, LH, LW } from "./desk";
import { coach, guideState, target } from "./guide";
import { castState } from "./session/cast";
import { threadsState } from "./session/threads-window";
import { rect, term } from "./shared/dom";
import { storyState } from "./story";
import { voiceState } from "./voice";

declare global {
  interface Window {
    __yuiLanding: typeof landingState;
  }
}
const landingState = () => ({
  speaking: voiceState.speaking,
  aa: vrm.expressionManager?.getValue("aa") ?? 0,
  phase: storyState.phase,
  step: guideState.step,
  state: bodyState.state,
  pinned: !!bodyState.pin,
  hips: proj(rHips),
  head: proj(rHead),
  term: rect(term),
  target: { ...target },
  pet: { ...pet },
  K,
  LW,
  LH,
  castT: castState.castT,
  playing: castState.playing,
  threadsOpen: threadsState.threadsOpen,
  box: threadsState.box,
  coach: coach.classList.contains("on") ? coach.textContent : null,
});

window.__yuiLanding = landingState;
