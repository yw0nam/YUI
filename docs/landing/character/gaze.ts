import * as THREE from "three";
import { clamp, DEG, smooth } from "../shared/math";
import { proj, readBody } from "./body";
import { nHead, nNeck, pitchSign, rHead, vrm } from "./load";

const gaze = { hy: 0, hp: 0, ey: 0, ep: 0 };
const gazeState = { gazePoint: null as { x: number; y: number } | null };
export function applyGaze(dt: number) {
  let ty = 0,
    tp = 0,
    ey = 0,
    ep = 0;
  if (
    gazeState.gazePoint &&
    readBody().state !== "drag" &&
    readBody().state !== "fall" &&
    readBody().state !== "peek" &&
    readBody().state !== "walk"
  ) {
    const h = proj(rHead),
      mountW = 400;
    let yaw = ((gazeState.gazePoint.x - h.x) / mountW) * 30,
      pitch = -((gazeState.gazePoint.y - h.y) / mountW) * 30;
    const mag = Math.hypot(yaw, pitch);
    if (mag > 40) {
      yaw *= 40 / mag;
      pitch *= 40 / mag;
    }
    const eW = mag <= 2 ? 0 : smooth(2, 6, mag),
      hW = smooth(6, 45, mag);
    ty = clamp(yaw * hW, -50, 50);
    tp = clamp(pitch * hW, -30, 30);
    ey = clamp(yaw * eW, -25, 25);
    ep = clamp(pitch * eW, -25, 25);
  }
  const k = 1 - Math.exp(-10 * dt);
  gaze.hy += (ty - gaze.hy) * k;
  gaze.hp += (tp - gaze.hp) * k;
  gaze.ey += (ey - gaze.ey) * k;
  gaze.ep += (ep - gaze.ep) * k;
  const q = (s: number) =>
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pitchSign * gaze.hp * s * DEG, gaze.hy * s * DEG, 0, "YXZ"),
    );
  nNeck.quaternion.multiply(q(0.4));
  nHead.quaternion.multiply(q(0.6));
  vrm.lookAt!.yaw = gaze.ey;
  vrm.lookAt!.pitch = -gaze.ep;
}

export function setGaze(point: { x: number; y: number } | null) {
  gazeState.gazePoint = point;
}
