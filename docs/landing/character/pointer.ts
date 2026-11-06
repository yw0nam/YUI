import { toDesk } from "../desk";
import { guideState, seatPoint, setStep } from "../guide";
import { grab } from "../shared/dom";
import { endPeek } from "../story";
import { beginDrag, bodyState, dragTo, drop, endDrag, feet, proj, setYaw } from "./body";
import { faceState } from "./face";
import { gazeState } from "./gaze";
import { charH, rHead } from "./load";
import { baseline, play } from "./motion";

addEventListener(
  "pointermove",
  (e) => {
    gazeState.gazePoint = toDesk(e);
  },
  { passive: true },
);
document.addEventListener("pointerleave", () => {
  gazeState.gazePoint = null;
});
let pressInfo: {
  p: { x: number; y: number };
  drag: boolean;
  pat: boolean;
  patTimer: ReturnType<typeof setTimeout> | undefined;
  peek: boolean;
} | null = null;
grab.addEventListener("pointerdown", (e) => {
  grab.setPointerCapture(e.pointerId);
  guideState.touched = true;
  const p = toDesk(e),
    hd = proj(rHead);
  pressInfo = {
    p,
    drag: false,
    pat: false,
    patTimer: undefined,
    peek: bodyState.state === "peek",
  };
  if (bodyState.state !== "peek" && Math.hypot(p.x - hd.x, p.y - hd.y) < 0.18 * charH)
    pressInfo!.patTimer = setTimeout(() => {
      if (pressInfo && !pressInfo.drag) {
        pressInfo.pat = true;
        faceState.relaxedUntil = performance.now() + 1e9;
        play("head_pat");
      }
    }, 300);
});
grab.addEventListener("pointermove", (e) => {
  if (!pressInfo || pressInfo.pat) return;
  const p = toDesk(e);
  if (!pressInfo.drag && Math.hypot(p.x - pressInfo.p.x, p.y - pressInfo.p.y) >= 4) {
    pressInfo.drag = true;
    clearTimeout(pressInfo.patTimer);
    beginDrag(pressInfo.p);
    if (guideState.step === "intro") setStep("seat", "Drag her onto the terminal.");
  }
  if (pressInfo.drag) dragTo(p);
});
const releasePress = () => {
  if (!pressInfo) return;
  clearTimeout(pressInfo.patTimer);
  if (pressInfo.drag) endDrag();
  else if (pressInfo.peek) endPeek();
  else if (pressInfo.pat) {
    faceState.relaxedUntil = performance.now() + 4000;
    play(baseline());
  }
  pressInfo = null;
};
grab.addEventListener("pointerup", releasePress);
grab.addEventListener("pointercancel", releasePress);
grab.addEventListener("keydown", (e) => {
  if ((e.key !== "Enter" && e.key !== " ") || bodyState.pin || bodyState.seatEase) return;
  e.preventDefault();
  if (guideState.step === "intro") setStep("seat");
  bodyState.peekX = null;
  setYaw(0);
  const s = seatPoint();
  feet.x = s.x;
  feet.y = Math.max(0, s.y - charH * 0.5);
  bodyState.state = "stand";
  drop();
});
