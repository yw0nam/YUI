/** The stance chip's atoms: the five-step glyph and its band motion, the direction mark, and the age text. */

import type { RelationBand } from "../../../../contract/types";
import { t } from "../../../i18n";

/** Which glyph segments each band lights. */
const LIT: Record<RelationBand, readonly string[]> = {
  hostile: ["-2", "-1"],
  cold: ["-1"],
  neutral: [],
  warm: ["1"],
  close: ["1", "2"],
};

const SVG = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const CHEVRON_SVG = SVG('<path d="M6 9l6 6 6-6"/>');
const UP_SVG = SVG('<path d="M6 15l6-6 6 6"/>');

export function glyphEl(band: RelationBand): HTMLElement {
  const glyph = document.createElement("span");
  glyph.className = "yui-glyph";
  glyph.dataset.band = band;
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML =
    '<span class="yui-glyph__seg" data-s="-2"></span><span class="yui-glyph__seg" data-s="-1"></span>' +
    '<span class="yui-glyph__mid"></span>' +
    '<span class="yui-glyph__seg" data-s="1"></span><span class="yui-glyph__seg" data-s="2"></span>';
  return glyph;
}

/** One stance: the glyph, and the target's name when `name` is given. */
export function stanceEl(p: {
  subject: string;
  target: string;
  band: RelationBand;
  label: string;
  name?: string;
}): HTMLElement {
  const el = document.createElement("span");
  el.className = "yui-stance";
  el.tabIndex = 0;
  el.dataset.subject = p.subject;
  el.dataset.target = p.target;
  el.setAttribute("aria-label", p.label);
  el.append(glyphEl(p.band));
  if (p.name !== undefined) {
    const to = document.createElement("span");
    to.className = "yui-stance__to";
    to.textContent = p.name;
    el.append(to);
  }
  return el;
}

/** The up or down chevron of a change, with its direction for a screen reader. */
export function directionHtml(delta: number): string {
  const word = t(delta > 0 ? "relation.rose" : "relation.fell");
  return `${delta > 0 ? UP_SVG : CHEVRON_SVG}<span class="yui-sr-only">${word}: </span>`;
}

/** `Nmin` under an hour, `Nh` under a day, else `Nd`. */
export function ageText(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}min`;
  return mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
}

/** Restarts a one-shot animation class. */
export function restart(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const ghostTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** Moves the glyph to `to`; the segments `from` lit and `to` does not stay as a ghost, then drain. */
export function bandShift(glyph: HTMLElement, from: RelationBand, to: RelationBand): void {
  for (const seg of glyph.querySelectorAll<HTMLElement>(".yui-glyph__seg")) {
    clearTimeout(ghostTimers.get(seg));
    seg.classList.remove("is-ghost", "is-draining");
  }
  glyph.dataset.band = from;
  if (from === to) return;
  const left = LIT[from]
    .filter((s) => !LIT[to].includes(s))
    .map((s) => glyph.querySelector<HTMLElement>(`[data-s="${s}"]`)!);
  for (const seg of left) {
    seg.style.setProperty("--yui-ghost", getComputedStyle(seg, "::after").backgroundColor);
  }
  glyph.dataset.band = to;
  for (const seg of left) {
    seg.classList.add("is-ghost");
    ghostTimers.set(
      seg,
      setTimeout(() => {
        seg.classList.replace("is-ghost", "is-draining");
        ghostTimers.set(
          seg,
          setTimeout(() => seg.classList.remove("is-draining"), 420),
        );
      }, 400),
    );
  }
}
