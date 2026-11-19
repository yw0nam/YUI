/**
 * Active hours section of the Persona page: the span rows (start · end · pace · remove),
 * the add action, and Reset to default. Any edit writes the whole row list to the
 * per-character store; the rows re-render from the store and the agent card.
 */

import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { Logger } from "../../../../logger";
import type { ActiveHoursSettingsStore } from "../../../../settings/active-hours/active-hours-settings";
import { spansInUse } from "../../../../settings/active-hours/card-active-hours";
import {
  MAX_SPANS,
  PACES,
  type Pace,
  type Span,
  TIME_RE,
  wrapsMidnight,
} from "../../../../settings/active-hours/spans";
import type { SettingsStores } from "../../../../settings/settings-stores";
import { getLocale, t } from "../../../i18n";
import { CROSS_SVG, PLUS_SVG } from "../../constants";
import { secHeadHtml } from "../../markup";
import "./active-hours-section.css";

export function activeHoursSectionHtml(): string {
  return `
        <div class="yui-sec yui-hours">
          ${secHeadHtml(
            t("active_hours.label"),
            `<button class="yui-reset" type="button" hidden>${t("card.reset")}</button>`,
          )}
          <p class="yui-sec__note">${t("active_hours.note")}</p>
          <div class="yui-group">
            <div class="yui-cue-list"></div>
            <div class="yui-row yui-row--action">
              <button class="yui-add-btn" type="button">${PLUS_SVG}${t("active_hours.add")}</button>
            </div>
          </div>
          <p class="yui-sec__note yui-hours__limit" hidden>${t("active_hours.add_limit")}</p>
          <p class="yui-sec__foot">${t("active_hours.foot")}</p>
        </div>`;
}

interface ActiveHoursSectionDeps {
  /** Panel root holding the section's markup. */
  root: HTMLElement;
  activeHoursSettings: ActiveHoursSettingsStore;
  agentSettings: Pick<SettingsStores["agentSettings"], "get" | "subscribe">;
  /** The bundled config's default cards; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  log: Logger;
}

interface ActiveHoursSection {
  /** Permanent teardown: unsubscribe and remove all listeners. */
  dispose(): void;
}

export function createActiveHoursSection(deps: ActiveHoursSectionDeps): ActiveHoursSection {
  const { root, activeHoursSettings: store, agentSettings, getPersona, log } = deps;
  const sec = root.querySelector<HTMLElement>(".yui-hours")!;
  const list = sec.querySelector<HTMLElement>(".yui-cue-list")!;
  const resetBtn = sec.querySelector<HTMLButtonElement>(".yui-reset")!;
  const addBtn = sec.querySelector<HTMLButtonElement>(".yui-add-btn")!;
  const limit = sec.querySelector<HTMLElement>(".yui-hours__limit")!;

  // The card this section reads spans from: the user's card, else the default card of the UI language.
  const card = () => agentSettings.get().card ?? getPersona?.()?.cards[getLocale()];
  const inUse = (): Span[] => spansInUse(store.get().spans, card());

  // A focused control keeps what the user is typing; it catches up on blur.
  function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
    if (document.hasFocus() && document.activeElement === el) return;
    if (el.value !== value) el.value = value;
  }

  function spanRow(span: Span): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-row yui-cue yui-hours__span";

    const range = document.createElement("div");
    range.className = "yui-hours__range";
    const start = document.createElement("input");
    start.type = "time";
    start.className = "yui-time-input";
    start.setAttribute("aria-label", t("active_hours.start_aria"));
    start.value = span.start;
    const dash = document.createElement("span");
    dash.className = "yui-hours__dash";
    dash.setAttribute("aria-hidden", "true");
    dash.textContent = "–";
    const end = document.createElement("input");
    end.type = "time";
    end.className = "yui-time-input";
    end.setAttribute("aria-label", t("active_hours.end_aria"));
    end.value = span.end;
    range.append(start, dash, end);
    if (wrapsMidnight(span)) {
      const nextDay = document.createElement("span");
      nextDay.className = "yui-cue__suffix";
      nextDay.textContent = t("active_hours.next_day");
      range.appendChild(nextDay);
    }

    const pace = document.createElement("select");
    pace.className = "yui-select yui-hours__pace";
    pace.setAttribute("aria-label", t("active_hours.pace_aria"));
    for (const p of PACES) {
      const option = document.createElement("option");
      option.value = p;
      option.textContent = t(`active_hours.pace_${p}`);
      pace.appendChild(option);
    }
    pace.value = span.pace;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "yui-cue__delete";
    remove.setAttribute("aria-label", t("active_hours.remove_aria"));
    remove.innerHTML = CROSS_SVG;

    row.append(range, pace, remove);
    return row;
  }

  function render(): void {
    resetBtn.hidden = store.get().spans === null;
    const spans = inUse();
    addBtn.disabled = spans.length >= MAX_SPANS;
    limit.hidden = !addBtn.disabled;
    const rows = list.querySelectorAll<HTMLElement>(".yui-hours__span");
    if (rows.length !== spans.length) {
      list.replaceChildren(...spans.map(spanRow));
      return;
    }
    // Same row count: reflect in place, so a focused control keeps what the user is typing.
    spans.forEach((span, i) => {
      const row = rows[i]!;
      const [start, end] = row.querySelectorAll<HTMLInputElement>(".yui-time-input");
      setValue(start, span.start);
      setValue(end, span.end);
      const pace = row.querySelector<HTMLSelectElement>(".yui-hours__pace")!;
      setValue(pace, span.pace);
      const nextDay = row.querySelector<HTMLElement>(".yui-cue__suffix");
      const wraps = wrapsMidnight(span);
      if (nextDay && !wraps) nextDay.remove();
      else if (!nextDay && wraps) {
        const mark = document.createElement("span");
        mark.className = "yui-cue__suffix";
        mark.textContent = t("active_hours.next_day");
        row.querySelector<HTMLElement>(".yui-hours__range")!.appendChild(mark);
      }
    });
  }

  // The whole row list is one edit: read every row, write one setSpans.
  function commit(skip?: HTMLElement): void {
    const rows = [...list.querySelectorAll<HTMLElement>(".yui-hours__span")].filter(
      (row) => row !== skip,
    );
    const next: Span[] = [];
    for (const row of rows) {
      const [start, end] = row.querySelectorAll<HTMLInputElement>(".yui-time-input");
      if (!TIME_RE.test(start.value) || !TIME_RE.test(end.value)) return;
      next.push({
        start: start.value,
        end: end.value,
        pace: row.querySelector<HTMLSelectElement>(".yui-hours__pace")!.value as Pace,
      });
    }
    store.setSpans(next);
  }

  function handleChange(e: Event): void {
    const el = e.target as HTMLElement;
    if (el.matches(".yui-time-input, .yui-hours__pace")) commit();
  }

  function handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest(".yui-add-btn")) {
      store.setSpans([...inUse(), { start: "09:00", end: "10:00", pace: "normal" }]);
    } else if (target.closest(".yui-reset")) {
      store.reset();
      log.info("active_hours_reset");
    } else {
      const remove = target.closest<HTMLElement>(".yui-cue__delete");
      if (remove) commit(remove.closest<HTMLElement>(".yui-hours__span") ?? undefined);
    }
  }

  render();
  const unsubscribes = [store.subscribe(render), agentSettings.subscribe(render)];
  sec.addEventListener("change", handleChange);
  sec.addEventListener("click", handleClick);

  return {
    dispose(): void {
      for (const off of unsubscribes) off();
      sec.removeEventListener("change", handleChange);
      sec.removeEventListener("click", handleClick);
    },
  };
}
