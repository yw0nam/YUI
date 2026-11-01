/**
 * The Threads window's top-level tabs: the tablist in its head (an Amber dot on the unselected tab
 * where something waits, the count of the selected one) and the switch between the tab bodies.
 */

import "./threads-tabs.css";
import type { ThreadsTab } from "../../../io/bridge/settings-bridge";
import { t } from "../../i18n";

const TABS: ThreadsTab[] = ["threads", "terminal"];

/** What the view hands each tab's body. */
export interface TabShell {
  /** The narrow layout's way back to the list, for the tab's pane head. */
  back: HTMLButtonElement;
  /** A row was picked: true when the list hid. */
  selected(): boolean;
  /** Focuses the selected row in the list or the rail, whichever shows. */
  focusSelected(): void;
  /** The tab's head count or waiting changed. */
  headChanged(): void;
}

/** A tab's body, laid out and keyed by the view's one layout. */
export interface TabBody {
  el: HTMLElement;
  /** Its list pane; a pointerdown inside keeps the overlay. */
  list: HTMLElement;
  /** The head's count while the tab shows ("" hides it), and whether something waits for the user. */
  head(): { count: string; waiting: boolean };
  hasSelection(): boolean;
  focusList(): void;
  focusRail(): void;
  move(delta: 1 | -1): void;
  /** Toggles the open ask's choice at `index`, where the tab has one. */
  pick?(index: number): void;
  /** Focuses the tab's text field; false when it has none. */
  focusField?(): boolean;
  /** Its tab became the shown one. */
  shown(): void;
  dispose(): void;
}

export function createThreadsTabs(deps: {
  /** Where the selected tab's count goes. */
  count: HTMLElement;
  /** A tab became the shown one. */
  onSwitch(body: TabBody): void;
}): {
  el: HTMLElement;
  /** Places `body` as `tab`'s panel, hidden unless `tab` is selected. */
  add(tab: ThreadsTab, body: TabBody): void;
  current(): TabBody;
  /** Shows `tab`, starting it over even when it already shows. */
  select(tab: ThreadsTab): void;
  /** Shows `tab` unless it already shows. */
  show(tab: ThreadsTab): void;
  renderHead(): void;
} {
  const bodies: Partial<Record<ThreadsTab, TabBody>> = {};
  let selected: ThreadsTab = "threads";

  const el = document.createElement("div");
  el.className = "yui-threads__tabs";
  el.setAttribute("role", "tablist");
  const buttons = TABS.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yui-threads__tab";
    button.id = `yui-threads-tab-${tab}`;
    button.dataset.tab = tab;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `yui-threads-panel-${tab}`);
    button.addEventListener("click", () => select(tab));
    return button;
  });
  el.append(...buttons);
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const at = TABS.indexOf((e.target as HTMLElement).dataset.tab as ThreadsTab);
    const next = (at + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    select(TABS[next]!);
    buttons[next]!.focus();
  });

  // A body redraws while it is built, before every tab has one.
  function renderHead(): void {
    el.setAttribute("aria-label", t("threads.tabs_aria"));
    TABS.forEach((tab, i) => {
      const button = buttons[i]!;
      const on = tab === selected;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
      button.replaceChildren(t(tab === "threads" ? "threads.title" : "terminal.title"));
      if (!on && bodies[tab]?.head().waiting) {
        const dot = document.createElement("span");
        dot.className = "yui-threads__tab-dot";
        dot.setAttribute("aria-hidden", "true");
        button.append(dot);
      }
    });
    deps.count.textContent = bodies[selected]?.head().count ?? "";
  }

  function select(tab: ThreadsTab): void {
    selected = tab;
    for (const [key, body] of Object.entries(bodies)) body.el.hidden = key !== tab;
    const body = bodies[tab]!;
    deps.onSwitch(body);
    renderHead();
    body.shown();
  }

  return {
    el,
    add(tab, body) {
      bodies[tab] = body;
      body.el.id = `yui-threads-panel-${tab}`;
      body.el.setAttribute("role", "tabpanel");
      body.el.setAttribute("aria-labelledby", `yui-threads-tab-${tab}`);
      body.el.hidden = tab !== selected;
      renderHead();
    },
    current: () => bodies[selected]!,
    select,
    show(tab) {
      if (tab !== selected) select(tab);
    },
    renderHead,
  };
}
