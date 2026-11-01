/** The Terminal tab's rail, the list folded to 56px: New terminal, then each terminal's owner mark, an Amber dot while a request waits on it. */

import type { AccessRequest, Terminal } from "../../contract";
import { t } from "../i18n";
import { ownerMark, PLUS_SVG, type PresetLookup, rowState } from "./terminal-meta";

function item(
  terminal: Terminal,
  requests: AccessRequest[],
  selected: boolean,
  preset: PresetLookup,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-threads-rail__item";
  el.dataset.id = terminal.id;
  el.setAttribute("aria-current", String(selected));
  const name = `${terminal.title} · ${rowState(terminal, requests, preset).text}`;
  el.setAttribute("aria-label", name);
  el.title = name;
  const mark = ownerMark(terminal, preset, 22);
  mark.setAttribute("aria-hidden", "true");
  el.append(mark);
  if (requests.some((r) => r.terminalId === terminal.id)) {
    const dot = document.createElement("span");
    dot.className = "yui-threads-rail__dot";
    dot.setAttribute("aria-hidden", "true");
    el.append(dot);
  }
  return el;
}

export function createTerminalRail(deps: {
  preset: PresetLookup;
  onSelect(id: string): void;
  onNew(): void;
}): {
  el: HTMLElement;
  render(terminals: Terminal[], requests: AccessRequest[], selected: string | null): void;
  focusSelected(): void;
} {
  const el = document.createElement("nav");
  el.className = "yui-threads-rail";
  el.innerHTML = `
    <div class="yui-threads-rail__top">
      <button type="button" class="yui-threads-rail__tab">${PLUS_SVG}</button>
    </div>
    <div class="yui-threads-rail__list"></div>
  `;
  const newEl = el.querySelector<HTMLButtonElement>(".yui-threads-rail__tab")!;
  const listEl = el.querySelector<HTMLElement>(".yui-threads-rail__list")!;
  newEl.addEventListener("click", deps.onNew);
  listEl.addEventListener("click", (e) => {
    const id = (e.target as Element).closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id !== undefined) deps.onSelect(id);
  });

  function focusSelected(): void {
    (listEl.querySelector<HTMLElement>('[aria-current="true"]') ?? newEl).focus();
  }

  return {
    el,
    render(terminals, requests, selected) {
      el.setAttribute("aria-label", t("terminal.rail_aria"));
      newEl.setAttribute("aria-label", t("terminal.new"));
      newEl.title = t("terminal.new");
      const hadFocus = listEl.contains(document.activeElement);
      if (terminals.length === 0) {
        const empty = document.createElement("p");
        empty.className = "yui-threads-rail__empty";
        empty.textContent = t("threads.rail_empty");
        listEl.replaceChildren(empty);
      } else {
        listEl.replaceChildren(
          ...terminals.map((term) => item(term, requests, term.id === selected, deps.preset)),
        );
      }
      if (hadFocus) focusSelected();
    },
    focusSelected,
  };
}
