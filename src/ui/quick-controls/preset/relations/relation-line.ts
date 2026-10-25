/** The relation line under the preset row: this window's preset, one relation per rated target. */

import { bandOf } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { relationEl } from "./relation-glyph";
import { type RelationsView, ratedInOrder } from "./view";

export function relationLineEl(view: RelationsView, isOpen: (id: string) => boolean): HTMLElement {
  const line = document.createElement("div");
  line.className = "yui-preset__rel";
  line.setAttribute("role", "group");
  line.setAttribute("aria-label", t("relation.group", { name: view.nameOf(view.self) }));
  const own = view.own;
  const targets = ratedInOrder(view.targets, own);
  if (targets.length === 0) {
    const empty = document.createElement("span");
    empty.className = "yui-preset__rel-empty";
    empty.textContent = t("relation.none");
    line.append(empty);
    return line;
  }
  const folds = (id: string): boolean => id !== "user" && !isOpen(id);
  // Open chips first, then the folded ones; each group keeps the value order.
  const ordered = [...targets.filter((id) => !folds(id)), ...targets.filter(folds)];
  const more = document.createElement("button");
  let folded = 0;
  for (const target of ordered) {
    const band = bandOf(own[target]!.value);
    const chip = relationEl({
      subject: view.self,
      target,
      band,
      label: view.label(target, band),
      name: view.nameOf(target),
    });
    if (folds(target)) {
      chip.setAttribute("data-folded", "");
      folded += 1;
    }
    line.append(chip);
  }
  more.type = "button";
  more.className = "yui-relation yui-relation--more";
  setMoreCount(more, folded);
  more.setAttribute("aria-expanded", "false");
  more.addEventListener("click", () => setUnfolded(line, !line.classList.contains("is-unfolded")));
  line.append(more);
  return line;
}

/** Shows every folded chip, the line wrapping, or folds them back. */
export function setUnfolded(line: HTMLElement, open: boolean): void {
  line.classList.toggle("is-unfolded", open);
  line.querySelector(".yui-relation--more")?.setAttribute("aria-expanded", String(open));
}

/** Folds the last shown chips but `user` into the `+N` chip until the line fits one row; a line not laid out is left as is. */
export function foldToWidth(line: HTMLElement): void {
  const more = line.querySelector<HTMLButtonElement>(".yui-relation--more");
  if (!more || line.clientWidth === 0) return;
  let folded = line.querySelectorAll("[data-folded]").length;
  const shown = [
    ...line.querySelectorAll<HTMLElement>(".yui-relation[data-target]:not([data-folded])"),
  ].filter((chip) => chip.dataset.target !== "user");
  while (line.scrollWidth > line.clientWidth && shown.length > 0) {
    shown.pop()!.setAttribute("data-folded", "");
    folded += 1;
    setMoreCount(more, folded);
  }
}

/** The `+N` chip for `n` folded chips, whether a closed window or the line's width folded them. */
function setMoreCount(more: HTMLButtonElement, n: number): void {
  more.hidden = n === 0;
  more.textContent = `+${n}`;
  more.setAttribute("aria-label", t("relation.more", { n }));
}

/** Calls `onChange` when `el`'s width changes, never for its height; a no-op without ResizeObserver. */
export function observeWidth(el: HTMLElement, onChange: () => void): () => void {
  if (typeof ResizeObserver !== "function") return () => {};
  let width = -1;
  const observer = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    onChange();
  });
  observer.observe(el);
  return () => observer.disconnect();
}
