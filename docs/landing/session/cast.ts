import { Terminal } from "@xterm/xterm";
import recording from "../cc.json";
import { $, cssVar } from "../shared/dom";
import { type Recording, store } from "./thread-store";

const CC = recording as unknown as Record<"allow" | "deny", Recording>;

const xt = new Terminal({
  cols: CC.allow.cols,
  rows: CC.allow.rows,
  fontSize: 13,
  lineHeight: 1.12,
  fontFamily: cssVar("--term-font"),
  theme: { background: cssVar("--term-bg"), foreground: cssVar("--term-fg") },
  disableStdin: true,
  cursorBlink: false,
  scrollback: 400,
});
xt.open($("termScreen"));
const castState = {
  rec: CC.allow,
  castT: 0,
  castStart: 0,
  holdT: 0,
  ei: 0,
  si: 0,
  playing: false,
};
export function switchTo(name: "allow" | "deny", at: number) {
  xt.reset();
  castState.rec = CC[name];
  castState.ei = 0;
  castState.si = 0;
  while (castState.ei < castState.rec.events.length && castState.rec.events[castState.ei][0] <= at)
    xt.write(castState.rec.events[castState.ei++][1]);
  while (
    castState.si < castState.rec.snapshots.length &&
    castState.rec.snapshots[castState.si].t <= at
  )
    castState.si++;
  castState.castT = at;
}
export function playTo(until: number) {
  castState.holdT = until;
  castState.castStart = performance.now() - castState.castT * 1000;
  castState.playing = true;
}
export function pumpCast(now: number) {
  if (!castState.playing) return;
  castState.castT = Math.min((now - castState.castStart) / 1000, castState.holdT);
  while (
    castState.ei < castState.rec.events.length &&
    castState.rec.events[castState.ei][0] <= castState.castT
  )
    xt.write(castState.rec.events[castState.ei++][1]);
  while (
    castState.si < castState.rec.snapshots.length &&
    castState.rec.snapshots[castState.si].t <= castState.castT
  )
    store.fromRecording(castState.rec.snapshots[castState.si++], castState.rec.snapshots[0].t);
  if (castState.castT >= castState.holdT) castState.playing = false;
}

export function seek(at: number) {
  castState.castT = at;
}
export function readCast() {
  return { castT: castState.castT, playing: castState.playing, marks: { ...castState.rec.marks } };
}
export function marks(name: "allow" | "deny") {
  return { ...CC[name].marks };
}
