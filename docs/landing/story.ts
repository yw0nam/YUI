import { readBody, startPeek } from "./character/body";
import { play } from "./character/motion";
import { announce, setStep } from "./guide/steps";
import { marks, playTo, readCast } from "./session/cast";
import { say } from "./session/speech";
import { store } from "./session/thread-store";
import { $, grab, reduced, term } from "./shared/dom";
import { wait } from "./shared/math";
import { soundBtn } from "./voice";

const CLOSING_LINE = "1,284 tests passed. Want me to open the PR for review?";

let phase = "intro";
export const currentPhase = () => phase;
async function intro() {
  term.classList.add("on");
  void playTo(marks().ready);
  await wait(reduced ? 0 : 1600);
  startPeek();
  grab.hidden = false;
  soundBtn.classList.add("on");
}

export async function startSession() {
  setStep("session", "Claude Code runs the tests, and its session shows in YUI's Threads window.");
  phase = "running";
  store.begin(readCast().castT);
  await playTo(marks().final);
  void playTo(marks().end);
  phase = "speaking";
  await wait(reduced ? 0 : 900);
  if (readBody().state === "stand") play("happy");
  announce(CLOSING_LINE);
  await say(CLOSING_LINE);
  phase = "done";
  setStep("done");
  $("links").classList.add("on");
  $("replay").classList.add("on");
}
$("replay").addEventListener("click", () => location.reload());

export function startStory() {
  void intro();
}
