/** The terminal list pane and its rail alike: New terminal on top, then one button per terminal, the selected one current and focusable. */

import type { AccessRequest, Terminal } from "../../contract";
import { keepFocus, reconcileRows, syncRow } from "../keyed-rows/keyed-rows";

export interface TerminalNav {
  el: HTMLElement;
  render(terminals: Terminal[], requests: AccessRequest[], selected: string | null): void;
  /** Focuses the selected terminal, or New terminal when there is none. */
  focusSelected(): void;
}

export function createTerminalNav(deps: {
  /** The nav's class: the Threads list's or the rail's. */
  className: string;
  /** The markup inside the nav: a `[data-new]` button and a `[data-items]` box. */
  html: string;
  label(): string;
  /** Labels New terminal for the locale. */
  labelNew(button: HTMLButtonElement): void;
  item(terminal: Terminal, requests: AccessRequest[]): HTMLElement;
  /** The class and text of the line shown with no terminal. */
  empty: { className: string; text(): string };
  onSelect(id: string): void;
  onNew(): void;
}): TerminalNav {
  const el = document.createElement("nav");
  el.className = deps.className;
  el.innerHTML = deps.html;
  const newEl = el.querySelector<HTMLButtonElement>("[data-new]")!;
  const itemsEl = el.querySelector<HTMLElement>("[data-items]")!;
  newEl.addEventListener("click", deps.onNew);
  itemsEl.addEventListener("click", (e) => {
    const id = (e.target as Element).closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id !== undefined) deps.onSelect(id);
  });

  function focusSelected(): void {
    (itemsEl.querySelector<HTMLElement>('[aria-current="true"]') ?? newEl).focus({
      preventScroll: true,
    });
  }

  function row(term: Terminal, requests: AccessRequest[], selected: string | null): HTMLElement {
    const item = deps.item(term, requests);
    item.dataset.id = term.id;
    item.setAttribute("aria-current", String(term.id === selected));
    return item;
  }

  return {
    el,
    render(terminals, requests, selected) {
      el.setAttribute("aria-label", deps.label());
      deps.labelNew(newEl);
      keepFocus(itemsEl, () => {
        if (terminals.length === 0) {
          const empty = document.createElement("p");
          empty.className = deps.empty.className;
          empty.textContent = deps.empty.text();
          itemsEl.replaceChildren(empty);
          return;
        }
        reconcileRows(itemsEl, terminals, {
          key: (term) => term.id,
          create: (term) => row(term, requests, selected),
          update: (el, term) => syncRow(el, row(term, requests, selected)),
        });
      });
    },
    focusSelected,
  };
}
