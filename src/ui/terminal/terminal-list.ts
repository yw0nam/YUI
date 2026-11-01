/** The Terminal tab's list pane: the New terminal button, then one row per terminal, newest first. */

import "./terminal-list.css";
import type { AccessRequest, Terminal } from "../../contract";
import { t } from "../i18n";
import { timeEl } from "../threads/window/relative-time";
import { ownerLine, PLUS_SVG, type PresetLookup, rowState, stateWord } from "./terminal-meta";

function row(
  terminal: Terminal,
  requests: AccessRequest[],
  selected: boolean,
  now: number,
  preset: PresetLookup,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-threads-row";
  el.dataset.id = terminal.id;
  el.setAttribute("aria-current", String(selected));
  const title = document.createElement("strong");
  title.textContent = terminal.title;
  const meta = document.createElement("span");
  meta.className = "yui-threads-row__meta";
  meta.append(stateWord(rowState(terminal, requests, preset)), timeEl(terminal.openedAt, now));
  el.append(ownerLine(terminal, preset), title, meta);
  return el;
}

export function createTerminalList(deps: {
  preset: PresetLookup;
  onSelect(id: string): void;
  onNew(): void;
}): {
  el: HTMLElement;
  render(
    terminals: Terminal[],
    requests: AccessRequest[],
    selected: string | null,
    now: number,
  ): void;
  /** Focuses the selected row, or New terminal when there is none. */
  focusSelected(): void;
} {
  const el = document.createElement("nav");
  el.className = "yui-threads-list";
  el.innerHTML = `
    <div class="yui-terminal-list__top">
      <button type="button" class="yui-terminal-list__new">${PLUS_SVG}<span></span></button>
    </div>
    <div class="yui-threads-list__rows"></div>
  `;
  const newEl = el.querySelector<HTMLButtonElement>(".yui-terminal-list__new")!;
  const rowsEl = el.querySelector<HTMLElement>(".yui-threads-list__rows")!;
  newEl.addEventListener("click", deps.onNew);
  rowsEl.addEventListener("click", (e) => {
    const id = (e.target as Element).closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id !== undefined) deps.onSelect(id);
  });

  function focusSelected(): void {
    (rowsEl.querySelector<HTMLElement>('[aria-current="true"]') ?? newEl).focus();
  }

  return {
    el,
    render(terminals, requests, selected, now) {
      el.setAttribute("aria-label", t("terminal.list_aria"));
      newEl.querySelector("span")!.textContent = t("terminal.new");
      const hadFocus = rowsEl.contains(document.activeElement);
      if (terminals.length === 0) {
        const empty = document.createElement("p");
        empty.className = "yui-threads-list__empty";
        empty.textContent = t("terminal.empty_list");
        rowsEl.replaceChildren(empty);
      } else {
        rowsEl.replaceChildren(
          ...terminals.map((term) => row(term, requests, term.id === selected, now, deps.preset)),
        );
      }
      if (hadFocus) focusSelected();
    },
    focusSelected,
  };
}
