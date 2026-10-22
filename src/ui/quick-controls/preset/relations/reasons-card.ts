/** The reasons card: on hover or focus of a stance, its band, the engine's note and the last three reasons. */

import { bandOf, type RelationRecord } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { ageText, directionHtml } from "./stance-glyph";

const CARD_ID = "yui-reasons";

export function createReasonsCard(deps: {
  strip: HTMLElement;
  recordOf(subject: string, target: string): RelationRecord | undefined;
  nameOf(id: string): string;
}): { close(): void; dispose(): void } {
  const { strip } = deps;
  const card = document.createElement("div");
  card.className = "yui-reasons";
  card.id = CARD_ID;
  card.setAttribute("role", "tooltip");
  strip.append(card);
  let openFor: HTMLElement | null = null;
  // Escape keeps the card shut for this stance until the pointer leaves it.
  let escaped: HTMLElement | null = null;

  const stanceOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(".yui-stance") : null;

  function fill(subject: string, target: string, record: RelationRecord): void {
    const head = document.createElement("p");
    head.className = "yui-reasons__head";
    const band = document.createElement("b");
    band.textContent = t(`relation.band.${bandOf(record.value)}`);
    const [before = "", after = ""] = t("relation.card_head", {
      subject: deps.nameOf(subject),
      band: "\u0000",
      target: deps.nameOf(target),
    }).split("\u0000");
    head.append(before, band, after);
    card.replaceChildren(head);
    if (record.note) {
      const note = document.createElement("p");
      note.className = "yui-reasons__note";
      note.textContent = record.note;
      card.append(note);
    }
    const list = document.createElement("ol");
    for (const change of record.log.slice(0, 3)) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${directionHtml(change.delta)}</span><span></span><span class="yui-reasons__age"></span>`;
      li.children[1]!.textContent = change.why;
      li.children[2]!.textContent = ageText(Date.now() - change.at);
      list.append(li);
    }
    card.append(list);
  }

  function open(stance: HTMLElement): void {
    const { subject = "", target = "" } = stance.dataset;
    const record = deps.recordOf(subject, target);
    if (!record) return;
    if (openFor !== stance) close();
    fill(subject, target, record);
    stance.setAttribute("aria-describedby", CARD_ID);
    const stripBox = strip.getBoundingClientRect();
    const box = stance.getBoundingClientRect();
    card.style.left = "0px";
    const left = Math.min(box.left - stripBox.left, strip.clientWidth - card.offsetWidth - 6);
    card.style.left = `${Math.max(6, left)}px`;
    card.style.top = `${box.bottom - stripBox.top + 6}px`;
    card.classList.add("is-open");
    openFor = stance;
  }

  function close(): void {
    card.classList.remove("is-open");
    openFor?.removeAttribute("aria-describedby");
    openFor = null;
  }

  const onOver = (e: Event): void => {
    const stance = stanceOf(e.target);
    if (stance && stance !== escaped) open(stance);
  };
  const onOut = (e: Event): void => {
    const stance = stanceOf(e.target);
    if (!stance || stance.contains((e as MouseEvent).relatedTarget as Node | null)) return;
    if (stance === escaped) escaped = null;
    if (stance === openFor && document.activeElement !== stance) close();
  };
  const onFocusIn = (e: Event): void => {
    const stance = stanceOf(e.target);
    if (stance) open(stance);
  };
  const onFocusOut = (e: Event): void => {
    if (stanceOf(e.target) === openFor) close();
  };
  // Esc closes the card alone; the panel stays open behind it.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !openFor) return;
    e.stopPropagation();
    escaped = openFor;
    close();
  };

  strip.addEventListener("pointerover", onOver);
  strip.addEventListener("pointerout", onOut);
  strip.addEventListener("focusin", onFocusIn);
  strip.addEventListener("focusout", onFocusOut);
  strip.addEventListener("keydown", onKeydown);
  return {
    close,
    dispose(): void {
      close();
      strip.removeEventListener("pointerover", onOver);
      strip.removeEventListener("pointerout", onOut);
      strip.removeEventListener("focusin", onFocusIn);
      strip.removeEventListener("focusout", onFocusOut);
      strip.removeEventListener("keydown", onKeydown);
      card.remove();
    },
  };
}
