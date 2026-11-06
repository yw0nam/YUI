import { readBody } from "./character/body";
import { charH } from "./character/load";
import { floorY, LH, LW, toDesk } from "./desk";
import { currentStep, noteTouched, type Step } from "./guide/steps";
import { $, term } from "./shared/dom";
import { clamp, rect } from "./shared/math";

const targetEl = $("target");
const target = { x: 0, y: 0 };
let dragging = false;
let onPlaced = () => {};
export function onTerminalPlaced(callback: () => void) {
  onPlaced = callback;
}
export function readTerminal() {
  return { dragging, target: { ...target } };
}
export function placeScene() {
  const w = term.offsetWidth,
    h = term.offsetHeight;
  term.style.top = `${Math.round(clamp(floorY() - h - 12, charH * 0.66, LH - h - 12))}px`;
  term.style.left = `${Math.round(clamp(LW * 0.5 - w / 2 + 40, 24, LW - w - 24))}px`;
  target.x = 48;
  target.y = term.offsetTop;
  placeTarget();
}
function placeTarget() {
  const w = term.offsetWidth,
    h = term.offsetHeight;
  target.y = clamp(target.y, 0, Math.max(0, LH - h - 12));
  Object.assign(targetEl.style, {
    left: `${target.x}px`,
    top: `${target.y}px`,
    width: `${w}px`,
    height: `${h}px`,
  });
}
export const seatPoint = () => {
  const r = rect(term);
  return { x: r.l + (r.r - r.l) * 0.72, y: r.t };
};
term.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || currentStep() === "intro") return;
  term.setPointerCapture(e.pointerId);
  dragging = true;
  noteTouched();
  const s = toDesk(e),
    ox = s.x - term.offsetLeft,
    oy = s.y - term.offsetTop,
    from = { x: term.offsetLeft, y: term.offsetTop };
  const mv = (ev: PointerEvent) => {
    const p = toDesk(ev);
    term.style.left = `${Math.round(clamp(p.x - ox, -term.offsetWidth + 80, LW - 80))}px`;
    term.style.top = `${Math.round(clamp(p.y - oy, -10, LH - 40))}px`;
  };
  const up = (ev: PointerEvent) => {
    dragging = false;
    const moved =
      ev.type === "pointerup" && Math.hypot(term.offsetLeft - from.x, term.offsetTop - from.y) > 40;
    term.removeEventListener("pointermove", mv);
    term.removeEventListener("pointerup", up);
    term.removeEventListener("pointercancel", up);
    if (
      moved &&
      currentStep() === "move" &&
      Math.hypot(term.offsetLeft - target.x, term.offsetTop - target.y) < 90
    )
      placeTerm();
  };
  term.addEventListener("pointermove", mv);
  term.addEventListener("pointerup", up);
  term.addEventListener("pointercancel", up);
});
function placeTerm() {
  term.style.left = `${target.x}px`;
  term.style.top = `${target.y}px`;
  if (currentStep() !== "move" || !readBody().pinned) return;
  onPlaced();
}
term.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && currentStep() === "move") {
    e.preventDefault();
    placeTerm();
  }
});

export function resizeTerminal() {
  if (currentStep() === "intro" || currentStep() === "seat") placeScene();
  else {
    term.style.left = `${clamp(term.offsetLeft, 80 - term.offsetWidth, LW - 80)}px`;
    term.style.top = `${clamp(term.offsetTop, -10, LH - 40)}px`;
  }
  placeTarget();
}
export function updateTerminal(step: Step) {
  term.classList.toggle("locked", step === "intro");
  targetEl.classList.toggle("on", step === "move");
}
