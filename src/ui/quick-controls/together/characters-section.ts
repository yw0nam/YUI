/**
 * Characters on the Together page: one row per preset with its face, name, state and an "On the
 * desktop" switch. Main's preset is always on, and so is a bound window's own preset there. A switch opens or closes the preset's own window
 * through `petWindows`; at `OPEN_PRESET_CAP` an off row's switch is disabled with the reason.
 */

import "./characters-section.css";
import type { Logger } from "../../../logger";
import { OPEN_PRESET_CAP, type PetWindows } from "../../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { t } from "../../i18n";
import { avatarEl } from "../../unified/avatar";
import { secHeadHtml } from "../markup";

export function charactersSectionHtml(): string {
  return `
        <div class="yui-sec yui-chars">
          ${secHeadHtml(t("chars.section"), `<span class="yui-sec__state yui-chars__count"></span>`)}
          <div class="yui-group yui-chars__rows" role="group" aria-label="${t("chars.section")}"></div>
        </div>`;
}

export function createCharactersSection(deps: {
  root: HTMLElement;
  registry: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows: Pick<PetWindows, "get" | "open" | "close" | "subscribe">;
  /** A bound window's own preset; turning it off would close the window showing this list. */
  boundId?: string | null;
  log: Logger;
}): { refresh(): void; dispose(): void } {
  const { registry, petWindows, log } = deps;
  const rowsEl = deps.root.querySelector<HTMLElement>(".yui-chars__rows")!;
  const countEl = deps.root.querySelector<HTMLElement>(".yui-chars__count")!;

  function rowEl(entry: { id: string; name: string; thumbnail?: string }): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-row yui-chars__row";
    row.innerHTML = `<div class="yui-row__main"><span class="yui-row__label"></span><span class="yui-row__sub yui-chars__meta"></span><span class="yui-row__sub yui-chars__reason" hidden></span></div><button class="yui-switch" type="button" role="switch"></button>`;
    row.prepend(avatarEl(entry, 28));
    row.querySelector(".yui-row__label")!.textContent = entry.name;
    const sw = row.querySelector<HTMLButtonElement>(".yui-switch")!;
    sw.setAttribute("aria-label", t("chars.switch_aria", { name: entry.name }));
    sw.addEventListener("click", () => {
      const on = petWindows.get().includes(entry.id);
      if (on) petWindows.close(entry.id);
      else if (!petWindows.open(entry.id)) render();
      log.info("character_desktop_toggle", { preset: entry.id, on: !on });
    });
    return row;
  }

  function render(): void {
    const { active, list } = registry.get();
    const open = petWindows.get();
    const count = new Set([active, ...open]).size;
    const full = count >= OPEN_PRESET_CAP;
    countEl.textContent = t("chars.count", { n: count, cap: OPEN_PRESET_CAP });
    rowsEl.replaceChildren(
      ...list.map((entry) => {
        const row = rowEl(entry);
        const main = entry.id === active;
        const own = entry.id === deps.boundId;
        const on = main || own || open.includes(entry.id);
        const capped = !on && full;
        const sw = row.querySelector<HTMLButtonElement>(".yui-switch")!;
        sw.setAttribute("aria-checked", String(on));
        sw.disabled = main || own || capped;
        row.classList.toggle("is-off", !on);
        row.querySelector(".yui-chars__meta")!.textContent = t(
          main ? "chars.in_main" : on ? "chars.on" : "chars.off",
        );
        const reason = row.querySelector<HTMLElement>(".yui-chars__reason")!;
        reason.hidden = !(capped || (own && !main));
        reason.textContent = own ? t("chars.this_window") : t("chars.cap_reason", { cap: OPEN_PRESET_CAP });
        return row;
      }),
    );
  }

  const offRegistry = registry.subscribe(render);
  const offWindows = petWindows.subscribe(render);
  return {
    refresh: render,
    dispose(): void {
      offRegistry();
      offWindows();
    },
  };
}
