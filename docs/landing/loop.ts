import * as THREE from "three";
import { advanceBody, pinBody, readBody } from "./character/body";
import { face } from "./character/face";
import { applyGaze } from "./character/gaze";
import { mixer, nHead, nNeck, vrm } from "./character/load";
import { overlays } from "./character/overlays";
import { cam, renderer, scene } from "./character/renderer";
import { guide } from "./guide/draw";
import { currentStep, finishWalk, updateSteps } from "./guide/steps";
import { pumpCast } from "./session/cast";
import { updateTerminal } from "./terminal";

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.1),
    now = performance.now();
  pumpCast(now);
  advanceBody(dt, finishWalk);
  nNeck.quaternion.identity();
  nHead.quaternion.identity();
  mixer.update(dt);
  applyGaze(dt);
  face(dt, now);
  vrm.update(dt);
  pinBody();
  overlays();
  updateSteps(readBody());
  updateTerminal(currentStep());
  guide(now, phase());
  renderer.render(scene, cam);
}

let phase = () => "intro";
export function startLoop(readPhase: () => string) {
  phase = readPhase;
  frame();
}
