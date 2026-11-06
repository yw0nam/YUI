import * as THREE from "three";
import { finishWalk, guide } from "../guide";
import { pumpCast } from "../session/cast";
import { advanceBody, pinBody } from "./body";
import { face } from "./face";
import { applyGaze } from "./gaze";
import { mixer, nHead, nNeck, vrm } from "./load";
import { overlays } from "./overlays";
import { cam, renderer, scene } from "./renderer";

const clock = new THREE.Clock();
export function frame() {
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
  guide(now);
  renderer.render(scene, cam);
}
