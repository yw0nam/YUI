/** The Threads window's top-level tabs in its head: Threads and Terminal, an Amber dot on the unselected one where something waits. */

import "./threads-tabs.css";
import type { ThreadsTab } from "../../../io/bridge/settings-bridge";
import { t } from "../../i18n";

const TABS: ThreadsTab[] = ["threads", "terminal"];

export function createThreadsTabs(deps: { onSelect(tab: ThreadsTab): void }): {
  el: HTMLElement;
  /** Draws `selected`, and a dot on each other tab `waiting` marks. */
  render(selected: ThreadsTab, waiting: Record<ThreadsTab, boolean>): void;
} {
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
    button.addEventListener("click", () => deps.onSelect(tab));
    return button;
  });
  el.append(...buttons);
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const at = TABS.indexOf((e.target as HTMLElement).dataset.tab as ThreadsTab);
    const next = (at + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    deps.onSelect(TABS[next]!);
    buttons[next]!.focus();
  });

  return {
    el,
    render(selected, waiting) {
      el.setAttribute("aria-label", t("terminal.tabs_aria"));
      TABS.forEach((tab, i) => {
        const button = buttons[i]!;
        const on = tab === selected;
        button.setAttribute("aria-selected", String(on));
        button.tabIndex = on ? 0 : -1;
        button.replaceChildren(t(tab === "threads" ? "threads.title" : "terminal.title"));
        if (!on && waiting[tab]) {
          const dot = document.createElement("span");
          dot.className = "yui-threads__tab-dot";
          dot.setAttribute("aria-hidden", "true");
          button.append(dot);
        }
      });
    },
  };
}
