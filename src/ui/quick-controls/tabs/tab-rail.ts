/**
 * Tab rail — the tablist shared by the desktop panel and the phone settings view: one visible
 * panel per selected button, roving tabindex, arrow/Home/End keyboard. Also renders the
 * button/panel markup pairs it wires.
 */

import { t } from "../../i18n";
import { escapeAttr } from "../markup";

export interface TabRail {
  /** Select a tab by id; with focus options, moves focus to its button with them. Unknown ids are ignored. Returns whether one matched. */
  select(id: string, focus?: FocusOptions | false): boolean;
  /** The selected tab's id. */
  selected(): string;
  dispose(): void;
}

interface TabRailDeps {
  /** The tablist container — click and keyboard events delegate from here. */
  rail: HTMLElement;
  buttons: readonly HTMLButtonElement[];
  panels: readonly HTMLElement[];
  /** Tab selected at build time; the fallback `selected()` reports before any selection. */
  initial: string;
  /** Called on every selection change, whatever drove it. */
  onSelect?: (id: string) => void;
}

/**
 * One rail button — labeled (desktop panel) or icon-only (phone view); icon-only drops the
 * tooltip, whose hover affordance a touch screen has no use for.
 */
export function tabButtonHtml(
  id: string,
  icon: string,
  opts: { selected?: boolean; label?: boolean; tipKey?: string } = {},
): string {
  const { selected = false, label = true, tipKey = `tabs.${id}` } = opts;
  const name = t(`tabs.${id}`);
  const tip = label ? ` data-tip="${escapeAttr(t(tipKey))}"` : "";
  return `
        <button class="yui-tab" type="button" role="tab" id="yui-tab-${id}" aria-selected="${String(selected)}" aria-controls="yui-panel-${id}" tabindex="${selected ? "0" : "-1"}"${tip} aria-label="${escapeAttr(name)}">
          ${icon}${
            label
              ? `
          <span class="yui-tab__label">${name}</span>`
              : ""
          }
        </button>`;
}

/** A tabpanel's opening tag pair: the panel div plus its in-panel title (dropped where a head owns the title). */
export function tabPanelOpenHtml(
  id: string,
  opts: { hidden?: boolean; title?: boolean } = {},
): string {
  const { hidden = true, title = true } = opts;
  return `
      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-${id}" aria-labelledby="yui-tab-${id}" tabindex="0"${hidden ? " hidden" : ""}>${
        title
          ? `
        <h1 class="yui-tabpanel__title">${t(`tabs.${id}`)}</h1>`
          : ""
      }`;
}

export function createTabRail(deps: TabRailDeps): TabRail {
  const { rail, buttons, panels, initial, onSelect } = deps;

  const panelByButton = new Map<HTMLButtonElement, HTMLElement>();
  for (const btn of buttons) {
    const panel = panels.find((p) => p.id === btn.getAttribute("aria-controls"));
    if (panel) panelByButton.set(btn, panel);
  }

  const idOf = (btn: HTMLButtonElement): string => btn.id.slice("yui-tab-".length);
  const buttonOf = (id: string): HTMLButtonElement | undefined =>
    buttons.find((b) => b.id === `yui-tab-${id}`);

  function select(id: string, focus: FocusOptions | false = false): boolean {
    const target = buttonOf(id);
    if (!target) return false;
    for (const btn of buttons) {
      const on = btn === target;
      btn.setAttribute("aria-selected", String(on));
      btn.tabIndex = on ? 0 : -1;
      const panel = panelByButton.get(btn);
      if (panel) panel.hidden = !on;
    }
    if (focus) target.focus(focus);
    onSelect?.(id);
    return true;
  }

  function handleTabClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-tab");
    if (!btn || !buttons.includes(btn)) return;
    select(idOf(btn));
  }

  function handleTabKeydown(e: KeyboardEvent): void {
    const current = buttons.findIndex((b) => b.getAttribute("aria-selected") === "true");
    const base = current < 0 ? 0 : current;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      select(idOf(buttons[(base + 1) % buttons.length]), {});
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      select(idOf(buttons[(base - 1 + buttons.length) % buttons.length]), {});
    } else if (e.key === "Home") {
      e.preventDefault();
      select(idOf(buttons[0]), {});
    } else if (e.key === "End") {
      e.preventDefault();
      select(idOf(buttons[buttons.length - 1]), {});
    }
  }

  rail.addEventListener("click", handleTabClick);
  rail.addEventListener("keydown", handleTabKeydown);

  return {
    select,
    selected: () => {
      const active = buttons.find((b) => b.getAttribute("aria-selected") === "true");
      return active ? idOf(active) : initial;
    },
    dispose() {
      rail.removeEventListener("click", handleTabClick);
      rail.removeEventListener("keydown", handleTabKeydown);
    },
  };
}
