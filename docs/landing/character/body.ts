import * as THREE from "three";
import { floorY, LH, LW } from "../desk";
import { reduced, term } from "../shared/dom";
import { clamp, rect, smooth } from "../shared/math";
import { actions, baseYawY, charH, hipsH, rHips, S, vrm } from "./load";
import { play } from "./motion";

const v3 = new THREE.Vector3();
const feet = { x: 0, y: 0 };
const bodyState = {
  state: "stand",
  pin: null as { el: HTMLElement; x0: number; y0: number } | null,
  pinDy: 0,
  peekX: null as number | null,
  fallV: 0,
  fallTarget: { el: null, t: 0 } as { el: HTMLElement | null; t: number },
  seatEase: null as { el: HTMLElement; t: number; from: number; to: number } | null,
  walkTo: 0,
  seatAfterTurn: false,
  dragOff: { x: 0, y: 0 },
};
const SEAT_EASE_MS = 500;
const WALK_YAW_RAD = Math.PI / 2,
  WALK_YAW_EASE_MS = 400,
  WALK_METRES_PER_CYCLE = 1.34;
const yaw = { from: 0, to: 0, t: 1, cur: 0 };
const setYaw = (to: number) => {
  yaw.from = yaw.cur;
  yaw.to = to;
  yaw.t = reduced ? 1 : 0;
};

export const proj = (o: THREE.Object3D) => {
  o.getWorldPosition(v3);
  return { x: v3.x * S, y: -v3.y * S };
};
const charW = () => charH * 0.36;
function planFall() {
  const room = 0.5 * charW(),
    r = rect(term);
  if (feet.y < r.t && feet.x >= r.l + room && feet.x <= r.r - room) return { el: term, t: r.t };
  return { el: null, t: floorY() };
}
function drop() {
  bodyState.pin = null;
  bodyState.seatEase = null;
  bodyState.peekX = null;
  const target = planFall(),
    d = target.t - feet.y;
  if (Math.abs(d) <= 24 || d < 0.2 * charH) {
    feet.y = target.t;
    return touchdown(target, false);
  }
  bodyState.fallTarget = target;
  bodyState.fallV = 0;
  bodyState.state = "fall";
  play("falling");
}
function touchdown(target: { el: HTMLElement | null; t: number }, fell: boolean) {
  if (target.el) return takeSeat(target.el, true);
  if (fell) {
    bodyState.state = "land";
    play("landing", () => {
      bodyState.state = "stand";
      play("idle");
    });
  } else {
    bodyState.state = "stand";
    play("idle");
  }
}
function takeSeat(el: HTMLElement, standingOnTop: boolean) {
  bodyState.state = "seating";
  bodyState.peekX = null;
  play("window_sit", null, 0.5);
  bodyState.seatEase = { el, t: 0, from: feet.y, to: standingOnTop ? feet.y + hipsH : feet.y };
}
function seated(el: HTMLElement) {
  bodyState.seatEase = null;
  bodyState.pinDy = 0;
  bodyState.pin = { el, x0: el.offsetLeft, y0: el.offsetTop };
  bodyState.state = "sit";
}
const inCatch = (r: ReturnType<typeof rect>, seat: { x: number; y: number }) =>
  seat.x >= r.l && seat.x <= r.r && seat.y >= r.t - 0.28 * charH && seat.y <= r.t + 0.23 * charH;

export function beginDrag(p: { x: number; y: number }) {
  if (bodyState.pin || bodyState.seatEase) feet.y = -vrm.scene.position.y * S;
  feet.x = vrm.scene.position.x * S;
  bodyState.pin = null;
  bodyState.pinDy = 0;
  bodyState.seatEase = null;
  bodyState.peekX = null;
  setYaw(0);
  bodyState.dragOff = { x: feet.x - p.x, y: feet.y - p.y };
  bodyState.state = "drag";
  play("drag");
}
export function dragTo(p: { x: number; y: number }) {
  feet.x = clamp(p.x + bodyState.dragOff.x, 10, LW - 10);
  feet.y = Math.min(floorY(), p.y + bodyState.dragOff.y);
}
export function endDrag() {
  if (inCatch(rect(term), proj(rHips))) return takeSeat(term, false);
  play("idle");
  drop();
}
function follow() {
  if (!bodyState.pin) return;
  const r = rect(bodyState.pin.el),
    dx = r.l - bodyState.pin.x0,
    dy = r.t - bodyState.pin.y0;
  feet.x += dx;
  feet.y += dy;
  bodyState.pin.x0 = r.l;
  bodyState.pin.y0 = r.t;
  const hips = proj(rHips),
    seat = { x: hips.x + dx, y: hips.y + dy };
  if (seat.x < 0 || seat.x > LW || r.t < 0 || r.t > LH) {
    feet.y = -vrm.scene.position.y * S;
    feet.x = clamp(feet.x, charW(), LW - charW());
    bodyState.pinDy = 0;
    drop();
  }
}

export function advanceBody(dt: number, onTurnDone: () => void) {
  if (bodyState.state === "fall") {
    bodyState.fallV = Math.min(bodyState.fallV + 1600 * dt, 1200);
    feet.y += bodyState.fallV * dt;
    if (bodyState.fallTarget.el) bodyState.fallTarget.t = bodyState.fallTarget.el.offsetTop;
    if (feet.y >= bodyState.fallTarget.t) {
      feet.y = bodyState.fallTarget.t;
      touchdown(bodyState.fallTarget, true);
    }
  } else if (
    (bodyState.state === "stand" || bodyState.state === "land" || bodyState.state === "walk") &&
    !bodyState.pin
  ) {
    feet.y = floorY();
  }
  if (bodyState.state === "walk") {
    feet.x = Math.min(
      bodyState.walkTo,
      feet.x + ((S * WALK_METRES_PER_CYCLE) / actions.walk.getClip().duration) * dt,
    );
    if (feet.x >= bodyState.walkTo) {
      bodyState.state = "stand";
      setYaw(0);
      play("idle");
      bodyState.seatAfterTurn = true;
    }
  }
  if (bodyState.seatAfterTurn && yaw.t >= 1) {
    bodyState.seatAfterTurn = false;
    onTurnDone();
  }
  if (yaw.t < 1) yaw.t = Math.min(1, yaw.t + (dt * 1000) / WALK_YAW_EASE_MS);
  yaw.cur = yaw.from + (yaw.to - yaw.from) * smooth(0, 1, yaw.t);
  vrm.scene.rotation.y = baseYawY + yaw.cur;
  if (bodyState.seatEase) {
    bodyState.seatEase.t += dt * 1000;
    const k = Math.min(1, bodyState.seatEase.t / SEAT_EASE_MS);
    feet.y =
      bodyState.seatEase.from + (bodyState.seatEase.to - bodyState.seatEase.from) * smooth(0, 1, k);
    if (k >= 1) seated(bodyState.seatEase.el);
  }
  if (bodyState.pin && bodyState.state === "sit") follow();
}

export function pinBody() {
  if (!(bodyState.pin && bodyState.state === "sit")) bodyState.pinDy = 0;
  vrm.scene.position.set(feet.x / S, -(feet.y + bodyState.pinDy) / S, 0);
  vrm.scene.updateMatrixWorld(true);
  const hp = proj(rHips);
  if (bodyState.pin && bodyState.state === "sit")
    bodyState.pinDy += (bodyState.pin.el.offsetTop - hp.y) * 0.6;
  if (bodyState.peekX !== null) feet.x += (bodyState.peekX - hp.x) * 0.6;
  vrm.scene.position.set(feet.x / S, -(feet.y + bodyState.pinDy) / S, 0);
  vrm.scene.updateMatrixWorld(true);
}

export function readBody() {
  return {
    state: bodyState.state,
    pinned: !!bodyState.pin,
    seating: !!bodyState.seatEase,
    sitting: bodyState.pin?.el === term && bodyState.state === "sit",
  };
}
export function baseline() {
  return bodyState.pin ? "window_sit" : "idle";
}
export function startPeek() {
  const r = rect(term);
  bodyState.peekX = r.r - 0.12 * charH;
  feet.x = bodyState.peekX;
  feet.y = r.b - 6;
  bodyState.state = "peek";
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
export function seatAt(point: { x: number; y: number }) {
  bodyState.peekX = null;
  setYaw(0);
  feet.x = point.x;
  feet.y = Math.max(0, point.y - charH * 0.5);
  bodyState.state = "stand";
  drop();
}
export function initializeBody() {
  feet.x = LW + 400;
  feet.y = floorY();
  play("idle");
}
export function clampIntoDesk() {
  if (bodyState.state === "peek") {
    const r = rect(term);
    bodyState.peekX = r.r - 0.12 * charH;
    feet.y = r.b - 6;
  }
  bodyState.walkTo = Math.min(bodyState.walkTo, LW - charW());
  if (!bodyState.pin && !bodyState.seatEase) feet.x = clamp(feet.x, charW(), LW - charW());
}
