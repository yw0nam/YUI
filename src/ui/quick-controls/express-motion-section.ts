/** Express motion cluster — a category accordion curating the agent-selectable motion vocabulary. */
import "./express-motion-section.css";
import {
  type ExpressMotionSettingsStore,
  enabledExpressMotions,
} from "../../io/express-motion-settings";
import type { Logger } from "../../logger";
import { t } from "../i18n";
import { HIST_CHEVRON_SVG } from "./constants";

/** Static display grouping. Ids the table does not name fall into the trailing `other` group. */
export const EXPRESS_MOTION_GROUPS: ReadonlyArray<{ id: string; ids: readonly string[] }> = [
  { id: "reaction", ids: ["happy", "laugh", "embarrassed", "sheepish", "calm", "sulk"] },
  { id: "action", ids: ["idle_lively", "sleeping", "dance"] },
];

const OTHER_GROUP = "other";

export interface ExpressMotionGroup {
  id: string;
  ids: string[];
}

/** Vocabulary → display groups, table order first, then whatever the table does not name. */
export function groupExpressMotions(vocabulary: readonly string[]): ExpressMotionGroup[] {
  const groups = EXPRESS_MOTION_GROUPS.map((group) => ({
    id: group.id,
    ids: group.ids.filter((id) => vocabulary.includes(id)),
  })).filter((group) => group.ids.length > 0);
  const named = new Set(EXPRESS_MOTION_GROUPS.flatMap((group) => group.ids));
  const rest = vocabulary.filter((id) => !named.has(id));
  return rest.length > 0 ? [...groups, { id: OTHER_GROUP, ids: rest }] : groups;
}

interface ExpressMotionListDeps {
  /** Panel root (el) — the section wrapper and accordion are queried from here. */
  root: HTMLElement;
  settings: ExpressMotionSettingsStore;
  /** Agent-triggerable motion ids from the loaded catalog; empty until configs load. */
  getVocabulary: () => readonly string[];
  log: Logger;
}

export interface ExpressMotionList {
  render(): void;
  dispose(): void;
}

export function createExpressMotionList(deps: ExpressMotionListDeps): ExpressMotionList {
  const { settings, getVocabulary, log } = deps;
  const sectionEl = deps.root.querySelector<HTMLDivElement>(".yui-express-motion")!;
  const listEl = deps.root.querySelector<HTMLDivElement>(".yui-express")!;
  // Ephemeral: the accordion opens closed on every panel open, and nothing persists it.
  const expanded = new Set<string>();

  /** Structure currently in the DOM — a mismatch means a rebuild, a match an in-place update. */
  function signature(groups: ExpressMotionGroup[]): string {
    return groups.map((g) => `${g.id}:${expanded.has(g.id) ? 1 : 0}:${g.ids.join(",")}`).join("|");
  }

  function rowEl(id: string, enabled: boolean): HTMLElement {
    const label = t(`express_motion.${id}.label`);
    const row = document.createElement("div");
    row.className = "yui-row";
    row.innerHTML = `
      <div class="yui-row__main">
        <span class="yui-row__label"></span>
        <span class="yui-row__sub"></span>
      </div>
      <button class="yui-switch" type="button" role="switch"></button>
    `;
    row.querySelector<HTMLSpanElement>(".yui-row__label")!.textContent = label;
    row.querySelector<HTMLSpanElement>(".yui-row__sub")!.textContent = t(
      `express_motion.${id}.sub`,
    );
    const sw = row.querySelector<HTMLButtonElement>(".yui-switch")!;
    sw.dataset.motion = id;
    sw.setAttribute("aria-label", label);
    sw.setAttribute("aria-checked", String(enabled));
    return row;
  }

  function groupEl(group: ExpressMotionGroup, enabled: readonly string[]): HTMLElement {
    const open = expanded.has(group.id);
    const name = t(`express_motion.group.${group.id}`);
    const rowsId = `yui-express-rows-${group.id}`;

    const wrap = document.createElement("div");
    wrap.className = open ? "yui-express__group is-open" : "yui-express__group";

    const head = document.createElement("div");
    head.className = "yui-express__head";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "yui-express__toggle";
    toggle.dataset.group = group.id;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-controls", rowsId);
    const chev = document.createElement("span");
    chev.className = open ? "yui-express__chev is-open" : "yui-express__chev";
    chev.innerHTML = HIST_CHEVRON_SVG;
    const nameEl = document.createElement("span");
    nameEl.className = "yui-express__name";
    nameEl.textContent = name;
    const count = document.createElement("span");
    count.className = "yui-express__count";
    toggle.append(chev, nameEl, count);

    const master = document.createElement("button");
    master.type = "button";
    master.className = "yui-switch yui-express__master";
    // A checkbox, not a switch: only checkbox supports the mixed state a partly-on group is in.
    master.setAttribute("role", "checkbox");
    master.dataset.group = group.id;
    master.setAttribute("aria-label", t("express_motion.master_aria", { group: name }));
    head.append(toggle, master);
    wrap.append(head);

    if (open) {
      const rows = document.createElement("div");
      rows.className = "yui-express__rows";
      rows.id = rowsId;
      rows.setAttribute("role", "group");
      rows.setAttribute("aria-label", name);
      for (const id of group.ids) rows.append(rowEl(id, enabled.includes(id)));
      wrap.append(rows);
    }
    return wrap;
  }

  /** Counts, master tri-state, and row switches — everything that changes without a rebuild. */
  function reflect(groups: ExpressMotionGroup[], enabled: readonly string[]): void {
    for (const group of groups) {
      const on = group.ids.filter((id) => enabled.includes(id)).length;
      const selector = `[data-group="${CSS.escape(group.id)}"]`;
      const count = listEl.querySelector<HTMLElement>(
        `.yui-express__toggle${selector} .yui-express__count`,
      );
      if (count) count.textContent = t("express_motion.count", { on, total: group.ids.length });
      const master = listEl.querySelector<HTMLButtonElement>(`.yui-express__master${selector}`);
      master?.setAttribute(
        "aria-checked",
        on === group.ids.length ? "true" : on === 0 ? "false" : "mixed",
      );
    }
    for (const sw of listEl.querySelectorAll<HTMLButtonElement>(".yui-express__rows .yui-switch")) {
      sw.setAttribute("aria-checked", String(enabled.includes(sw.dataset.motion!)));
    }
  }

  let rendered = "";

  function render(): void {
    const vocabulary = getVocabulary();
    sectionEl.hidden = vocabulary.length === 0;
    const groups = groupExpressMotions(vocabulary);
    const enabled = enabledExpressMotions(vocabulary, settings.get());
    const next = signature(groups);
    // Toggling only flips switches — rebuilding the rows would drop keyboard focus mid-interaction.
    if (next !== rendered) {
      listEl.replaceChildren(...groups.map((group) => groupEl(group, enabled)));
      rendered = next;
    }
    reflect(groups, enabled);
  }

  function groupIds(id: string): string[] {
    return groupExpressMotions(getVocabulary()).find((g) => g.id === id)?.ids ?? [];
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const master = target.closest<HTMLButtonElement>(".yui-express__master");
    if (master) {
      const id = master.dataset.group!;
      const next = master.getAttribute("aria-checked") !== "true";
      settings.setAllEnabled(groupIds(id), next);
      log.info("express_motion_group_toggle", { group: id, enabled: next });
      return;
    }
    const toggle = target.closest<HTMLButtonElement>(".yui-express__toggle");
    if (!toggle) {
      const sw = target.closest<HTMLButtonElement>(".yui-express__rows .yui-switch");
      if (!sw) return;
      const next = sw.getAttribute("aria-checked") !== "true";
      settings.setEnabled(sw.dataset.motion!, next);
      log.info("express_motion_toggle", { motion: sw.dataset.motion, enabled: next });
      return;
    }
    const id = toggle.dataset.group!;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    const hadFocus = document.activeElement === toggle;
    render();
    // The header was rebuilt — keyboard users keep their place on it.
    if (hadFocus) {
      listEl
        .querySelector<HTMLButtonElement>(`.yui-express__toggle[data-group="${CSS.escape(id)}"]`)
        ?.focus();
    }
  }

  listEl.addEventListener("click", handleClick);

  return {
    render,
    dispose: () => listEl.removeEventListener("click", handleClick),
  };
}
