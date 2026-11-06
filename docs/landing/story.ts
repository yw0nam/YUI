import type { AskAnswer } from "../../src/contract/index";
import { bodyState, charW, feet, proj, setYaw, WALK_YAW_RAD } from "./character/body";
import { frame } from "./character/frame";
import { charH, rHips } from "./character/load";
import { play } from "./character/motion";
import { floorY, LH, LW, toDesk } from "./desk";
import { guideState, live, placeScene, setStep, target } from "./guide";
import { castState, playTo, startRec, xt } from "./session/cast";
import { CC } from "./session/recording";
import { say } from "./session/speech";
import { store } from "./session/thread-store";
import { $, clamp, grab, rect, reduced, term, wait } from "./shared/dom";
import { soundBtn } from "./voice";
export const storyState = { phase: "intro", termDrag: false };
async function intro() {
  term.classList.add("on");
  startRec("allow", 0);
  playTo(CC.allow.marks.ready);
  await wait(reduced ? 0 : 1600);
  const r = rect(term);
  bodyState.peekX = r.r - 0.12 * charH;
  feet.x = bodyState.peekX;
  feet.y = r.b - 6;
  bodyState.state = "peek";
  grab.hidden = false;
  soundBtn.classList.add("on");
  play("peek", endPeek);
}
export function endPeek() {
  if (bodyState.state !== "peek") return;
  bodyState.peekX = null;
  feet.x = clamp(proj(rHips).x, charW(), LW - charW());
  feet.y = floorY();
  bodyState.walkTo = Math.min(rect(term).r + 0.45 * charH, LW - charW());
  if (bodyState.walkTo > feet.x) {
    bodyState.state = "walk";
    play("walk");
    setYaw(WALK_YAW_RAD);
  } else {
    bodyState.state = "stand";
    play("idle");
    bodyState.seatAfterTurn = true;
  }
}

term.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || guideState.step === "intro") return;
  term.setPointerCapture(e.pointerId);
  storyState.termDrag = true;
  guideState.touched = true;
  const s = toDesk(e),
    ox = s.x - term.offsetLeft,
    oy = s.y - term.offsetTop,
    from = { x: term.offsetLeft, y: term.offsetTop };
  const mv = (ev: PointerEvent) => {
    const p = toDesk(ev);
    term.style.left = Math.round(clamp(p.x - ox, -term.offsetWidth + 80, LW - 80)) + "px";
    term.style.top = Math.round(clamp(p.y - oy, -10, LH - 40)) + "px";
  };
  const up = (ev: PointerEvent) => {
    storyState.termDrag = false;
    const moved =
      ev.type === "pointerup" && Math.hypot(term.offsetLeft - from.x, term.offsetTop - from.y) > 40;
    term.removeEventListener("pointermove", mv);
    term.removeEventListener("pointerup", up);
    term.removeEventListener("pointercancel", up);
    if (
      moved &&
      guideState.step === "move" &&
      Math.hypot(term.offsetLeft - target.x, term.offsetTop - target.y) < 90
    )
      placeTerm();
  };
  term.addEventListener("pointermove", mv);
  term.addEventListener("pointerup", up);
  term.addEventListener("pointercancel", up);
});
function placeTerm() {
  term.style.left = target.x + "px";
  term.style.top = target.y + "px";
  if (guideState.step !== "move" || !bodyState.pin) return;
  setStep("session", "Claude Code runs the tests and asks for permission through YUI.");
  storyState.phase = "running";
  store.begin(castState.castT);
  playTo(CC.allow.marks.answer);
}
term.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && guideState.step === "move") {
    e.preventDefault();
    placeTerm();
  }
});
store.subscribe((s) => {
  if (storyState.phase === "running" && s.threads.some((th) => th.ask?.prompt === "Allow Bash?"))
    storyState.phase = "asking";
});
const story = {
  choice: "allow" as "allow" | "deny",
  answered(ans: AskAnswer) {
    const choice = ans.choice === "allow" ? "allow" : "deny";
    storyState.phase = "working";
    this.choice = choice;
    live.textContent =
      choice === "allow" ? "Allowed. Claude Code runs the tests." : "Denied. Claude Code stops.";
    if (choice === "deny") {
      xt.reset();
      startRec("deny", CC.deny.marks.answer);
    } else castState.castT = CC.allow.marks.answer;
    playTo(castState.rec.marks.end - 0.05);
  },
};
store.onAnswer((prompt, answer) => {
  if (prompt === "Allow Bash?" && storyState.phase === "asking") story.answered(answer);
});
store.subscribe((s) => {
  if (storyState.phase !== "working" || !s.threads.some((th) => th.ask?.prompt === "What next?"))
    return;
  storyState.phase = "speaking";
  setTimeout(async () => {
    if (bodyState.state === "stand") play("happy");
    const line =
      story.choice === "allow"
        ? "1,284 tests passed. Want me to open the PR for review?"
        : "Okay. I left the tests alone.";
    live.textContent = line;
    await say(line, story.choice);
    storyState.phase = "done";
    setStep("done");
    $("links").classList.add("on");
    $("replay").classList.add("on");
  }, 900);
});
$("replay").addEventListener("click", () => location.reload());

export function start() {
  placeScene();
  feet.x = LW + 400;
  feet.y = floorY();
  play("idle");
  frame();
  void intro();
}
