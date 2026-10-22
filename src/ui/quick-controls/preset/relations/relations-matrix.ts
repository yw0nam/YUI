/** The relations matrix, a disclosure under the relation line: every preset's relation toward every target. */

import { bandOf } from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { ageText, directionHtml, relationEl } from "./relation-glyph";
import type { RelationsView } from "./view";

/** The newest statement across every preset: a logged change, or an engine note written after it. */
function latest(view: RelationsView) {
  let best: { subject: string; target: string; at: number; text: string; delta?: number } | null =
    null;
  for (const [subject, relations] of Object.entries(view.relations)) {
    for (const [target, record] of Object.entries(relations)) {
      const last = record.log[0];
      const statement =
        record.note && (!last || record.updated_at > last.at)
          ? { at: record.updated_at, text: record.note }
          : last && { at: last.at, text: last.why, delta: last.delta };
      if (statement && (!best || statement.at > best.at)) best = { subject, target, ...statement };
    }
  }
  return best;
}

function latestEl(view: RelationsView, nowMs: number): HTMLElement {
  const p = document.createElement("p");
  p.className = "yui-matrix__latest";
  const l = latest(view);
  if (!l) return p;
  p.innerHTML = `${l.delta ? directionHtml(l.delta) : ""}<span class="yui-matrix__latest-text"><span class="yui-matrix__latest-who"></span> <span class="yui-matrix__latest-what"></span></span>`;
  p.querySelector(".yui-matrix__latest-who")!.textContent = t("relation.latest", {
    subject: view.nameOf(l.subject),
    target: view.nameOf(l.target),
    age: ageText(nowMs - l.at),
  });
  p.querySelector(".yui-matrix__latest-what")!.textContent = l.text;
  return p;
}

export function relationsMatrixEl(view: RelationsView, open: boolean, nowMs: number): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "yui-preset__matrix";
  wrap.classList.toggle("is-open", open);
  const matrix = document.createElement("div");
  matrix.className = "yui-matrix";
  const table = document.createElement("table");
  table.setAttribute("aria-label", t("relation.matrix_table"));
  const cols = ["user", ...view.presets.map((p) => p.id)];
  const head = table.createTHead().insertRow();
  head.append(document.createElement("th"));
  for (const col of cols) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = view.nameOf(col);
    head.append(th);
  }
  const body = table.createTBody();
  for (const { id, name } of view.presets) {
    const tr = body.insertRow();
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = name;
    tr.append(th);
    for (const col of cols) {
      const td = tr.insertCell();
      if (col === id) continue;
      const record = view.relations[id]?.[col];
      if (record) {
        const band = bandOf(record.value);
        td.append(relationEl({ subject: id, target: col, band, label: view.label(id, col, band) }));
      } else {
        td.className = "is-empty";
        td.setAttribute(
          "aria-label",
          t("relation.unrated", { subject: name, target: view.nameOf(col) }),
        );
      }
    }
  }
  matrix.append(table, latestEl(view, nowMs));
  const inner = document.createElement("div");
  inner.append(matrix);
  wrap.append(inner);
  return wrap;
}
