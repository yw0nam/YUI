import type { AskAnswer } from "../../src/contract";
import { readBody, startPeek } from "./character/body";
import { play } from "./character/motion";
import { announce, setStep } from "./guide/steps";
import { marks, playTo, readCast, seek, switchTo } from "./session/cast";
import { say } from "./session/speech";
import { store } from "./session/thread-store";
import { $, grab, reduced, term } from "./shared/dom";
import { wait } from "./shared/math";
import { soundBtn } from "./voice";

let phase = "intro";
export const currentPhase = () => phase;
async function intro() {
  term.classList.add("on");
  switchTo("allow", 0);
  playTo(marks("allow").ready);
  await wait(reduced ? 0 : 1600);
  startPeek();
  grab.hidden = false;
  soundBtn.classList.add("on");
}

export function startSession() {
  setStep("session", "Claude Code runs the tests and asks for permission through YUI.");
  phase = "running";
  store.begin(readCast().castT);
  playTo(marks("allow").answer);
}
store.subscribe((s) => {
  if (phase === "running" && s.threads.some((th) => th.ask?.prompt === "Allow Bash?"))
    phase = "asking";
});
let choice: "allow" | "deny" = "allow";
function answered(ans: AskAnswer) {
  choice = ans.choice === "allow" ? "allow" : "deny";
  phase = "working";
  announce(
    choice === "allow" ? "Allowed. Claude Code runs the tests." : "Denied. Claude Code stops.",
  );
  if (choice === "deny") switchTo("deny", marks("deny").answer);
  else seek(marks("allow").answer);
  playTo(readCast().marks.end - 0.05);
}
store.onAnswer((prompt, answer) => {
  if (prompt === "Allow Bash?" && phase === "asking") answered(answer);
});
store.subscribe((s) => {
  if (phase !== "working" || !s.threads.some((th) => th.ask?.prompt === "What next?")) return;
  phase = "speaking";
  setTimeout(async () => {
    if (readBody().state === "stand") play("happy");
    const line =
      choice === "allow"
        ? "1,284 tests passed. Want me to open the PR for review?"
        : "Okay. I left the tests alone.";
    announce(line);
    await say(line, choice);
    phase = "done";
    setStep("done");
    $("links").classList.add("on");
    $("replay").classList.add("on");
  }, 900);
});
$("replay").addEventListener("click", () => location.reload());

export function startStory() {
  void intro();
}
