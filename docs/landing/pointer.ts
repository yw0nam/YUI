import {
  baseline,
  beginDrag,
  dragTo,
  endDrag,
  endPeek,
  proj,
  readBody,
  seatAt,
} from "./character/body";
import { beginPat, endPat } from "./character/face";
import { setGaze } from "./character/gaze";
import { charH, rHead } from "./character/load";
import { play } from "./character/motion";
import { toDesk } from "./desk";
import { currentStep, noteTouched, setStep } from "./guide/steps";
import { grab } from "./shared/dom";
import { seatPoint } from "./terminal";

addEventListener(
  "pointermove",
  (e) => {
    setGaze(toDesk(e));
  },
  { passive: true },
);
document.addEventListener("pointerleave", () => {
  setGaze(null);
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
  noteTouched();
  const p = toDesk(e),
    hd = proj(rHead);
  pressInfo = {
    p,
    drag: false,
    pat: false,
    patTimer: undefined,
    peek: readBody().state === "peek",
  };
  if (readBody().state !== "peek" && Math.hypot(p.x - hd.x, p.y - hd.y) < 0.18 * charH)
    pressInfo.patTimer = setTimeout(() => {
      if (pressInfo && !pressInfo.drag) {
        pressInfo.pat = true;
        beginPat();
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
    if (currentStep() === "intro") setStep("seat", "Drag her onto the terminal.");
  }
  if (pressInfo.drag) dragTo(p);
});
const releasePress = () => {
  if (!pressInfo) return;
  clearTimeout(pressInfo.patTimer);
  if (pressInfo.drag) endDrag();
  else if (pressInfo.peek) endPeek();
  else if (pressInfo.pat) {
    endPat();
    play(baseline());
  }
  pressInfo = null;
};
grab.addEventListener("pointerup", releasePress);
grab.addEventListener("pointercancel", releasePress);
grab.addEventListener("keydown", (e) => {
  if ((e.key !== "Enter" && e.key !== " ") || readBody().pinned || readBody().seating) return;
  e.preventDefault();
  if (currentStep() === "intro") setStep("seat");
  seatAt(seatPoint());
});
