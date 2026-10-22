/** The relation line under the preset row: this window's preset, one relation per rated target. */

import { bandOf } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { CHEVRON_SVG, relationEl } from "./relation-glyph";
import type { RelationsView } from "./view";

export function relationLineEl(view: RelationsView, open: boolean): HTMLElement {
  const line = document.createElement("div");
  line.className = "yui-preset__rel";
  line.setAttribute("role", "group");
  line.setAttribute("aria-label", t("relation.group", { name: view.nameOf(view.self) }));
  const own = view.relations[view.self] ?? {};
  const targets = view.targetsOf(view.self).filter((id) => own[id]);
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
  if (view.presets.length > 1) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "yui-iconbtn yui-preset__rel-more";
    more.setAttribute("aria-label", t("relation.matrix"));
    more.setAttribute("aria-expanded", String(open));
    more.innerHTML = CHEVRON_SVG;
    line.append(more);
  }
  return line;
}
