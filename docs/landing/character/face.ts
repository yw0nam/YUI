import * as THREE from "three";
import { rms, voiceState } from "../voice";
import { vrm } from "./load";
export const faceState = {
  nextBlink: 3 + Math.random() * 3,
  blinkT: -1,
  mouthOn: false,
  relaxedUntil: 0,
};
export function face(dt: number, now: number) {
  const em = vrm.expressionManager;
  if (!em) return;
  faceState.nextBlink -= dt;
  if (faceState.nextBlink <= 0 && faceState.blinkT < 0) faceState.blinkT = 0;
  if (faceState.blinkT >= 0) {
    faceState.blinkT += dt;
    em.setValue(
      "blink",
      faceState.blinkT < 0.075
        ? faceState.blinkT / 0.075
        : Math.max(0, 1 - (faceState.blinkT - 0.075) / 0.075),
    );
    if (faceState.blinkT >= 0.15) {
      faceState.blinkT = -1;
      faceState.nextBlink = 3 + Math.random() * 3;
      em.setValue("blink", 0);
    }
  }
  if (voiceState.speaking) {
    voiceState.mouthA += (rms() - voiceState.mouthA) * 0.4;
    voiceState.mouthB += (voiceState.mouthA - voiceState.mouthB) * 0.4;
    em.setValue("aa", voiceState.mouthB);
  } else {
    voiceState.mouthA = voiceState.mouthB = 0;
    em.setValue(
      "aa",
      faceState.mouthOn
        ? 0.15 + 0.45 * Math.abs(Math.sin(now / 85)) * Math.abs(Math.sin(now / 53))
        : THREE.MathUtils.damp(em.getValue("aa") ?? 0, 0, 12, dt),
    );
  }
  em.setValue(
    "relaxed",
    THREE.MathUtils.damp(em.getValue("relaxed") ?? 0, now < faceState.relaxedUntil ? 1 : 0, 3, dt),
  );
}
