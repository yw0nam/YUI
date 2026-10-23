/** The relation line under the preset row: this window's preset, one relation per rated target. */

import { bandOf } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { relationEl } from "./relation-glyph";
import type { RelationsView } from "./view";

export function relationLineEl(view: RelationsView, isOpen: (id: string) => boolean): HTMLElement {
  const line = document.createElement("div");
  line.className = "yui-preset__rel";
  line.setAttribute("role", "group");
  line.setAttribute("aria-label", t("relation.group", { name: view.nameOf(view.self) }));
  const own = view.relations[view.self] ?? {};
  // "you" first when rated, then the rated targets by value, close first; ties keep registry order.
  const targets = view
    .targetsOf(view.self)
    .filter((id) => own[id])
    .sort((a, b) => (a === "user" ? -1 : b === "user" ? 1 : own[b]!.value - own[a]!.value));
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
  let folded = 0;
  for (const target of ordered) {
    const band = bandOf(own[target]!.value);
    const chip = relationEl({
      subject: view.self,
      target,
      band,
      label: view.label(view.self, target, band),
      name: view.nameOf(target),
    });
    if (folds(target)) {
      chip.setAttribute("data-folded", "");
      folded += 1;
    }
    line.append(chip);
  }
  if (folded > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "yui-relation yui-relation--more";
    more.textContent = `+${folded}`;
    more.setAttribute("aria-label", t("relation.more", { n: folded }));
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", () => {
      const open = !line.classList.contains("is-unfolded");
      line.classList.toggle("is-unfolded", open);
      more.setAttribute("aria-expanded", String(open));
    });
    line.append(more);
  }
  return line;
}
