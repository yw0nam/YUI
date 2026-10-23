/** The relation line under the preset row: this window's preset, one relation per rated target. */

import { bandOf } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { relationEl } from "./relation-glyph";
import type { RelationsView } from "./view";

export function relationLineEl(view: RelationsView): HTMLElement {
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
  line.hidden =
    targets.length === 0 &&
    !Object.values(view.relations).some((rel) => Object.keys(rel).length > 0);
  for (const target of targets) {
    const band = bandOf(own[target]!.value);
    line.append(
      relationEl({
        subject: view.self,
        target,
        band,
        label: view.label(view.self, target, band),
        name: view.nameOf(target),
      }),
    );
  }
  return line;
}
