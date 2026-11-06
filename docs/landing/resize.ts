import { bodyState, charW, feet } from "./character/body";
import { charH, S } from "./character/load";
import { resize } from "./character/renderer";
import { LH, LW } from "./desk";
import { guideState, placeScene, placeTarget } from "./guide";
import { fitThreadsBox, placeThreads, threadsState } from "./session/threads-window";
import { clamp, rect, term } from "./shared/dom";

addEventListener("resize", () => {
  resize(S);
  if (guideState.step === "intro" || guideState.step === "seat") placeScene();
  else {
    term.style.left = clamp(term.offsetLeft, 80 - term.offsetWidth, LW - 80) + "px";
    term.style.top = clamp(term.offsetTop, -10, LH - 40) + "px";
  }
  placeTarget();
  if (bodyState.state === "peek") {
    const r = rect(term);
    bodyState.peekX = r.r - 0.12 * charH;
    feet.y = r.b - 6;
  }
  bodyState.walkTo = Math.min(bodyState.walkTo, LW - charW());
  if (!bodyState.pin && !bodyState.seatEase) feet.x = clamp(feet.x, charW(), LW - charW());
  if (threadsState.box) {
    fitThreadsBox();
    if (threadsState.threadsOpen) placeThreads();
  }
});
