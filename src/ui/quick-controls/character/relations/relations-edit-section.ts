/**
 * Relations section — one row per target with a slider that sets this preset's relation by hand,
 * and the Relations switch in the section head. This module owns the handlers, the store and switch
 * subscriptions, the repaints and teardown; the tab only constructs it.
 */

import "./relations-edit.css";
import type { RelationBand } from "../../../../contract/types";
import type { Logger } from "../../../../logger";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import {
  bandOf,
  type RelationRecord,
  type RelationsStore,
  SET_BY_USER,
} from "../../../../settings/relations/relations-store";
import { t } from "../../../i18n";
import { ageText, glyphEl } from "../../preset/relations/relation-glyph";

const MAX = 20;

/** `+9`, `−6` with a true minus, `0`. */
const signed = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

export function createRelationsEditSection(deps: {
  /** Tab root; the section is queried from here. */
  root: HTMLElement;
  store: RelationsStore;
  relationsSwitch: FlagSettingsStore;
  /** This window's preset id. */
  self: string;
  presets: () => readonly PresetEntry[];
  /** Skip repaints while the tab is closed. */
  isOpen: () => boolean;
  log: Logger;
}): { refresh(): void; dispose(): void } {
  const { root, store, relationsSwitch, self, log } = deps;
  const sectionEl = root.querySelector<HTMLElement>(".yui-relations")!;
  const switchEl = sectionEl.querySelector<HTMLButtonElement>(".yui-relations__switch")!;
  const noteEl = sectionEl.querySelector<HTMLElement>(".yui-relations__note")!;
  const offEl = sectionEl.querySelector<HTMLElement>(".yui-relations__off")!;
  const rowsEl = sectionEl.querySelector<HTMLElement>(".yui-relations__rows")!;
  const rows = new Map<string, HTMLElement>();

  const nameOf = (id: string): string =>
    id === "user" ? t("relation.to_you") : (deps.presets().find((p) => p.id === id)?.name ?? id);

  /** The band word, then the last reason and its age; no record reads `fallback`. */
  function subText(band: RelationBand, record: RelationRecord | undefined, fallback: string) {
    if (!record) return fallback;
    const last = record.log[0];
    const why = last?.why === SET_BY_USER ? t("relations.set_by_you") : (last?.why ?? "");
    const age = ageText(Date.now() - (last?.at ?? record.updated_at));
    return [t(`relation.band.${band}`), why, age].filter(Boolean).join(" · ");
  }

  /** The slider's value shown on the row: glyph, number, fill, and the screen-reader text. */
  function paintValue(row: HTMLElement, value: number, glyphBand: RelationBand | "none"): void {
    const slider = row.querySelector<HTMLInputElement>(".yui-relations__slider")!;
    const band = bandOf(value);
    row.querySelector<HTMLElement>(".yui-glyph")!.dataset.band = glyphBand;
    row.querySelector(".yui-relations__value")!.textContent = signed(value);
    slider.dataset.band = band;
    slider.style.setProperty("--pos", String(Math.max(0, value) / (2 * MAX)));
    slider.style.setProperty("--neg", String(Math.max(0, -value) / (2 * MAX)));
    slider.setAttribute("aria-valuetext", `${t(`relation.band.${band}`)}, ${signed(value)}`);
  }

  function rowEl(target: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-row yui-relations__row";
    row.dataset.target = target;
    row.innerHTML = `<div class="yui-row__main"><span class="yui-row__label"><span class="yui-relations__name"></span></span><span class="yui-row__sub"></span></div><div class="yui-relations__ctl"><input type="range" class="yui-gain__slider yui-relations__slider" min="${-MAX}" max="${MAX}" step="1"><span class="yui-relations__value"></span></div>`;
    row.querySelector(".yui-row__label")!.prepend(glyphEl("none"));
    const slider = row.querySelector<HTMLInputElement>(".yui-relations__slider")!;
    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      const band = bandOf(value);
      paintValue(row, value, band);
      row.querySelector(".yui-row__sub")!.textContent = subText(
        band,
        store.all()[target],
        t(`relation.band.${band}`),
      );
    });
    slider.addEventListener("change", () => {
      const { band, applied } = store.set(target, Number(slider.value), SET_BY_USER, Date.now());
      // A write repaints through the store subscription; a release at the stored value repaints here.
      if (applied > 0) log.info("relation_set", { target, value: Number(slider.value), band });
      else render();
    });
    return row;
  }

  function render(): void {
    const on = relationsSwitch.get().enabled;
    switchEl.setAttribute("aria-checked", String(on));
    rowsEl.hidden = !on;
    noteEl.hidden = !on;
    offEl.hidden = on;
    noteEl.textContent = t("relations.note", { name: nameOf(self) });

    const own = store.all();
    const targets = [
      "user",
      ...deps
        .presets()
        .map((p) => p.id)
        .filter((id) => id !== self),
    ];
    // "you" first when rated, then the rated targets by value, close first; ties keep registry order.
    const rated = targets
      .filter((id) => own[id])
      .sort((a, b) => (a === "user" ? -1 : b === "user" ? 1 : own[b]!.value - own[a]!.value));
    const unrated = targets.filter((id) => !own[id]);
    for (const [id, row] of rows) {
      if (!targets.includes(id)) {
        row.remove();
        rows.delete(id);
      }
    }
    const ordered = [...rated, ...unrated].map((target, i) => {
      const row = rows.get(target) ?? rowEl(target);
      rows.set(target, row);
      const record = own[target];
      const value = record?.value ?? 0;
      const slider = row.querySelector<HTMLInputElement>(".yui-relations__slider")!;
      slider.value = String(value);
      slider.setAttribute(
        "aria-label",
        t("relations.slider_aria", { name: nameOf(self), target: nameOf(target) }),
      );
      row.querySelector(".yui-relations__name")!.textContent = nameOf(target);
      paintValue(row, value, record ? bandOf(value) : "none");
      row.querySelector(".yui-row__sub")!.textContent = subText(
        bandOf(value),
        record,
        t("relations.not_rated"),
      );
      row.classList.toggle("is-unrated", !record);
      row.classList.toggle("is-first-unrated", i === rated.length);
      return row;
    });
    // Rows move around a focused one, so a slider in use keeps its focus.
    const focused = ordered.find((row) => row.contains(document.activeElement));
    if (focused) {
      const at = ordered.indexOf(focused);
      focused.before(...ordered.slice(0, at));
      focused.after(...ordered.slice(at + 1));
    } else rowsEl.append(...ordered);
  }

  function handleSwitchClick(): void {
    const enabled = !relationsSwitch.get().enabled;
    relationsSwitch.setEnabled(enabled);
    log.info("relations_toggle", { enabled });
  }

  const repaint = (): void => {
    if (deps.isOpen()) render();
  };
  switchEl.addEventListener("click", handleSwitchClick);
  const offStore = store.subscribe(repaint);
  const offSwitch = relationsSwitch.subscribe(repaint);

  return {
    refresh: render,
    dispose(): void {
      offStore();
      offSwitch();
      switchEl.removeEventListener("click", handleSwitchClick);
    },
  };
}
