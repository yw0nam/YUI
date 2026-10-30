/**
 * The Threads window's rail, the list pane folded to 56px: the Waiting and All tabs as a mark over
 * each count, the kind select under a funnel mark, and one source mark per row of the same list
 * view, an Amber dot while it waits.
 */

import "./thread-rail.css";
import type { Thread } from "../../../contract";
import { t } from "../../i18n";
import { threadSource } from "../thread-source";
import { renderKinds, type ThreadFilter, type ThreadListView } from "./thread-list";
import { stateText } from "./thread-meta";

const glyph = (paths: string): string =>
  `<svg class="yui-threads-glyph" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const WAITING_SVG = glyph(
  '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
);
const ALL_SVG = glyph(
  '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
);
const FUNNEL_SVG = glyph('<path d="M4 5h16l-6 7.5V18l-4 2v-7.5z"/>');

function item(thread: Thread, selected: boolean): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-threads-rail__item";
  el.dataset.id = thread.id;
  el.setAttribute("aria-current", String(selected));
  const name = `${thread.title} · ${stateText(thread)}`;
  el.setAttribute("aria-label", name);
  el.title = name;
  const mark = document.createElement("span");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = threadSource(thread.source).mark;
  el.append(mark);
  if (thread.state === "input-required") {
    const dot = document.createElement("span");
    dot.className = "yui-threads-rail__dot";
    dot.setAttribute("aria-hidden", "true");
    el.append(dot);
  }
  return el;
}

export function createThreadRail(deps: {
  onSelect(id: string): void;
  onFilter(filter: ThreadFilter): void;
}): {
  el: HTMLElement;
  render(view: ThreadListView, filter: ThreadFilter, selected: string | null): void;
  focusSelected(): void;
} {
  const el = document.createElement("nav");
  el.className = "yui-threads-rail";
  el.innerHTML = `
    <div class="yui-threads-rail__top">
      <button type="button" class="yui-threads-rail__tab" data-rail-tab="waiting">
        ${WAITING_SVG}<span class="yui-threads-rail__count is-waiting"></span>
      </button>
      <button type="button" class="yui-threads-rail__tab" data-rail-tab="all">
        ${ALL_SVG}<span class="yui-threads-rail__count"></span>
      </button>
      <span class="yui-threads-rail__kind">
        <span class="yui-threads-rail__kind-mark" aria-hidden="true"></span>
        <select></select>
      </span>
    </div>
    <div class="yui-threads-rail__list"></div>
  `;
  const tabs = [...el.querySelectorAll<HTMLButtonElement>("[data-rail-tab]")];
  const kindEl = el.querySelector<HTMLElement>(".yui-threads-rail__kind")!;
  const kindMark = el.querySelector<HTMLElement>(".yui-threads-rail__kind-mark")!;
  const selectEl = el.querySelector("select")!;
  const listEl = el.querySelector<HTMLElement>(".yui-threads-rail__list")!;
  let filter: ThreadFilter = { tab: "waiting", kind: null };

  for (const tab of tabs) {
    tab.addEventListener("click", () =>
      deps.onFilter({ ...filter, tab: tab.dataset.railTab as ThreadFilter["tab"] }),
    );
  }
  selectEl.addEventListener("change", () =>
    deps.onFilter({ ...filter, kind: selectEl.selectedIndex === 0 ? null : selectEl.value }),
  );
  listEl.addEventListener("click", (e) => {
    const id = (e.target as Element).closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id !== undefined) deps.onSelect(id);
  });

  function focusSelected(): void {
    listEl.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }

  return {
    el,
    render(view, next, selected) {
      filter = next;
      el.setAttribute("aria-label", t("threads.rail_aria"));
      for (const tab of tabs) {
        const isWaiting = tab.dataset.railTab === "waiting";
        const n = isWaiting ? view.counts.waiting : view.counts.all;
        const name = t(isWaiting ? "threads.waiting_count" : "threads.all_count", { n });
        tab.querySelector(".yui-threads-rail__count")!.textContent = String(n);
        tab.setAttribute("aria-label", name);
        tab.title = name;
        tab.setAttribute("aria-pressed", String(tab.dataset.railTab === filter.tab));
      }
      renderKinds(selectEl, view);
      selectEl.setAttribute("aria-label", t("threads.kind"));
      kindEl.title = t("threads.kind");
      kindEl.dataset.active = String(view.kind !== null);
      if (view.kind === null) kindMark.innerHTML = FUNNEL_SVG;
      else kindMark.textContent = threadSource(view.kind).mark;

      const hadFocus = listEl.contains(document.activeElement);
      if (view.rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "yui-threads-rail__empty";
        empty.textContent = t("threads.rail_empty");
        listEl.replaceChildren(empty);
      } else {
        listEl.replaceChildren(...view.rows.map((th) => item(th, th.id === selected)));
      }
      if (hadFocus) focusSelected();
    },
    focusSelected,
  };
}
