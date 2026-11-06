import * as THREE from "three";
import { reduced } from "../shared/dom";
import { bodyState } from "./body";
import { actions, mixer } from "./load";

const MOTIONS = {
  idle: { pool: ["calm", "idle_01", "idle_04", "idle_12"], mode: "pingpong", fade: 0.5 },
  window_sit: {
    pool: ["sit_01", "sit_02", "sit_03", "sit_04", "sit_05", "suwari1", "suwari3"],
    mode: "pingpong",
    fade: 0.7,
  },
  peek: { pool: ["peek"], mode: "once", fade: 0.7 },
  walk: { pool: ["walk"], mode: "loop", fade: 0.5 },
  drag: { pool: ["drag"], mode: "loop", fade: 0.5 },
  falling: { pool: ["falling"], mode: "loop", fade: 0.5 },
  landing: { pool: ["landing"], mode: "once", fade: 0.5 },
  happy: { pool: ["happy"], mode: "once", fade: 0.5 },
  head_pat: { pool: ["idle_10"], mode: "pingpong", fade: 0.5 },
};
let cur = {
  id: "idle" as keyof typeof MOTIONS,
  name: null as string | null,
  action: null as THREE.AnimationAction | null,
  onDone: null as (() => void) | null,
};
export function play(
  id: keyof typeof MOTIONS,
  onDone: (() => void) | null = null,
  fade = MOTIONS[id].fade,
) {
  const def = MOTIONS[id];
  const choices = def.pool.length > 1 ? def.pool.filter((n) => n !== cur.name) : def.pool;
  const name = choices[Math.floor(Math.random() * choices.length)];
  const a = actions[name],
    prev = cur.action;
  a.reset();
  a.enabled = true;
  a.setEffectiveTimeScale(1);
  a.setEffectiveWeight(1);
  if (def.mode === "loop") {
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
  } else if (def.mode === "once") {
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
  } else {
    a.setLoop(THREE.LoopPingPong, 2 * (1 + Math.floor(Math.random() * 3)));
    a.clampWhenFinished = true;
  }
  a.play();
  if (prev && prev !== a) a.crossFadeFrom(prev, reduced ? 0.01 : fade, false);
  cur = { id, name, action: a, onDone };
}
export const baseline = () => (bodyState.pin ? "window_sit" : "idle");
mixer.addEventListener("finished", (e) => {
  if (e.action !== cur.action) return;
  if (MOTIONS[cur.id].mode === "pingpong") return play(cur.id);
  const f = cur.onDone;
  cur.onDone = null;
  f ? f() : play(baseline());
});
