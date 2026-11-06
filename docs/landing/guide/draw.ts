import { proj, readBody } from "../character/body";
import { charH, rHips } from "../character/load";
import { surfaces } from "../character/overlays";
import { deskRect, LH, LW } from "../desk";
import { readThreadsWindow } from "../session/threads-window";
import { $, reduced, term, threadsWin } from "../shared/dom";
import { clamp, rect } from "../shared/math";
import { readTerminal, seatPoint } from "../terminal";
import { readGuide } from "./steps";

const coach = $("coach"),
  ring = $("ring"),
  arc = $("arc"),
  arcPath = $<SVGPathElement>("arcPath"),
  arcHead = $<SVGPathElement>("arcHead"),
  arcHand = $<SVGGElement>("arcHand");
const seatMark = $("seatMark");

let arcOn = false,
  arcT0 = 0;
function show(el: HTMLElement | SVGElement, on: boolean) {
  el.classList.toggle("on", on);
}
function label(text: string, x: number, y: number, anchor = "below") {
  coach.textContent = text;
  show(coach, true);
  const w = coach.offsetWidth,
    h = coach.offsetHeight;
  const tx = anchor === "right" ? x : anchor === "left" ? x - w : x - w / 2;
  const ty = anchor === "above" ? y - h : anchor === "below" ? y : y - h / 2;
  coach.style.transform = `translate(${Math.round(clamp(tx, 8, LW - w - 8))}px, ${Math.round(clamp(ty, 8, LH - h - 8))}px)`;
}
function ringOn(r: ReturnType<typeof rect> | null, pad = 4) {
  if (!r) return show(ring, false);
  show(ring, true);
  Object.assign(ring.style, {
    transform: `translate(${r.l - pad}px, ${r.t - pad}px)`,
    width: `${r.r - r.l + 2 * pad}px`,
    height: `${r.b - r.t + 2 * pad}px`,
  });
}

function drawArc(from: { x: number; y: number }, to: { x: number; y: number }) {
  if (!arcOn) {
    arcOn = true;
    arcT0 = performance.now();
  }
  show(arc, true);
  const cx = (from.x + to.x) / 2,
    cy = Math.min(from.y, to.y) - Math.max(60, Math.abs(to.x - from.x) * 0.35);
  arcPath.setAttribute("d", `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`);
  const L = arcPath.getTotalLength();
  const pe = arcPath.getPointAtLength(L),
    pn = arcPath.getPointAtLength(L - 4);
  arcHead.setAttribute(
    "transform",
    `translate(${pe.x} ${pe.y}) rotate(${(Math.atan2(pe.y - pn.y, pe.x - pn.x) * 180) / Math.PI})`,
  );
  if (reduced) return;
  const t = (performance.now() - arcT0) % 2000;
  let len = 0.25,
    op = 0,
    lift = 0;
  if (t < 100) op = t / 100;
  else if (t < 1600) {
    len = 0.25 + 0.5 * ((t - 100) / 1500);
    op = 1;
  } else if (t < 1800) {
    len = 0.75;
    const k = (t - 1600) / 200;
    op = 1 - k;
    lift = 12 * k;
  }
  const p = arcPath.getPointAtLength(L * len);
  arcHand.setAttribute("transform", `translate(${p.x} ${p.y - lift})`);
  arcHand.style.opacity = String(op);
}
const hideArc = () => {
  arcOn = false;
  show(arc, false);
};
export function guide(now: number, phase: string) {
  const { step, idle } = readGuide(now);
  const body = readBody();
  const { dragging, target } = readTerminal();
  const { threadsOpen } = readThreadsWindow();
  show(seatMark, step === "seat");
  if (step === "seat") {
    const s = seatPoint();
    seatMark.style.transform = `translate(${s.x - 60}px, ${s.y - 2}px)`;
    if (body.state !== "drag") label("Drag here", s.x, s.y - 14, "above");
    else show(coach, false);
    if (idle && body.state !== "drag") {
      const h = proj(rHips);
      drawArc({ x: h.x, y: h.y - 0.1 * charH }, { x: s.x, y: s.y - 10 });
    } else hideArc();
    ringOn(null);
  } else if (step === "move") {
    const r = rect(term);
    if (!dragging)
      label(
        "Drag the window here",
        target.x + (r.r - r.l) / 2,
        target.y + (r.b - r.t) / 2,
        "center",
      );
    else show(coach, false);
    if (idle && !dragging)
      drawArc(
        { x: (r.l + r.r) / 2, y: r.t + 60 },
        { x: target.x + (r.r - r.l) / 2, y: target.y + 40 },
      );
    else hideArc();
    ringOn(null);
  } else if (step === "session") {
    hideArc();
    const chipEl = surfaces.chipColumn.querySelector<HTMLElement>(".yui-threadchip");
    const answer = threadsWin.querySelector(".yui-threads-answer");
    if (!threadsOpen && chipEl && !chipEl.hidden) {
      const c = deskRect(chipEl);
      label("Click this", c.r + 12, (c.t + c.b) / 2, "right");
      ringOn(c, 3);
      ring.style.borderRadius = "999px";
    } else if (threadsOpen && answer && phase === "asking") {
      const picked = answer.querySelector('.yui-threads-answer__choices [aria-pressed="true"]');
      const send = answer.querySelector(".yui-threads-answer__send");
      const el =
        picked && !(send as HTMLButtonElement).disabled
          ? send
          : answer.querySelector(".yui-threads-answer__choices");
      const r = deskRect(el!);
      ring.style.borderRadius = "12px";
      ringOn(r, 4);
      label(el === send ? "Send it" : "Choose one", r.l - 12, (r.t + r.b) / 2, "left");
    } else {
      show(coach, false);
      ringOn(null);
    }
  } else {
    show(coach, false);
    ringOn(null);
    hideArc();
  }
}

export function coachText() {
  return coach.classList.contains("on") ? coach.textContent : null;
}
