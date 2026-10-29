/** The Threads window's list pane: Waiting / All tabs, the kind select, and one row per Thread. */

import "./thread-list.css";
import type { Thread } from "../../../contract";
import { t } from "../../i18n";
import { threadSource } from "../thread-source";
import { relativeTime } from "./relative-time";
import { sourceLine, stateWord } from "./thread-meta";

export interface ThreadFilter {
  tab: "waiting" | "all";
  /** A source, or null for all kinds. */
  kind: string | null;
}

export interface ThreadListView {
  rows: Thread[];
  counts: { waiting: number; all: number };
  /** Every source in the snapshot, counted within the tab; a zero count is disabled unless selected. */
  kinds: { source: string; count: number; disabled: boolean }[];
  /** The kind in effect: the filter's, or null once that source left the snapshot. */
  kind: string | null;
}

const waits = (thread: Thread): boolean => thread.state === "input-required";
const waitingFirstThenNewest = (a: Thread, b: Thread): number =>
  Number(waits(b)) - Number(waits(a)) || b.updated_at - a.updated_at;

export function threadListView(threads: Thread[], filter: ThreadFilter): ThreadListView {
  const sources = [...new Set(threads.map((th) => th.source))].sort();
  const kind = filter.kind !== null && sources.includes(filter.kind) ? filter.kind : null;
  const inTab = threads.filter((th) => filter.tab === "all" || waits(th));
  return {
    rows: inTab.filter((th) => kind === null || th.source === kind).sort(waitingFirstThenNewest),
    counts: { waiting: threads.filter(waits).length, all: threads.length },
    kinds: sources.map((source) => {
      const count = inTab.filter((th) => th.source === source).length;
      return { source, count, disabled: count === 0 && source !== kind };
    }),
    kind,
  };
}

/** The Thread a fresh open shows: the newest waiting one, else the newest. */
export function openSelection(threads: Thread[]): string | null {
  return [...threads].sort(waitingFirstThenNewest)[0]?.id ?? null;
}

function row(thread: Thread, selected: boolean, now: number): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-threads-row";
  el.dataset.id = thread.id;
  el.setAttribute("aria-current", String(selected));
  const title = document.createElement("strong");
  title.textContent = thread.title;
  el.append(sourceLine(thread.source), title);
  if (thread.label) {
    const label = document.createElement("span");
    label.className = "yui-threads-row__label";
    label.textContent = thread.label;
    label.title = thread.label;
    el.append(label);
  }
  const meta = document.createElement("span");
  meta.className = "yui-threads-row__meta";
  const time = document.createElement("time");
  time.textContent = relativeTime(thread.updated_at, now);
  meta.append(stateWord(thread), time);
  el.append(meta);
  return el;
}

export function createThreadList(deps: {
  onSelect(id: string): void;
  onFilter(filter: ThreadFilter): void;
}): {
  el: HTMLElement;
  render(view: ThreadListView, filter: ThreadFilter, selected: string | null, now: number): void;
  focusSelected(): void;
} {
  const el = document.createElement("nav");
  el.className = "yui-threads-list";
  el.innerHTML = `
    <div class="yui-threads-list__tabs">
      <button type="button" data-tab="waiting"></button>
      <button type="button" data-tab="all"></button>
    </div>
    <select class="yui-threads-list__kind"></select>
    <div class="yui-threads-list__rows"></div>
  `;
  const tabs = [...el.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const kindEl = el.querySelector<HTMLSelectElement>(".yui-threads-list__kind")!;
  const rowsEl = el.querySelector<HTMLElement>(".yui-threads-list__rows")!;
  let filter: ThreadFilter = { tab: "waiting", kind: null };

  for (const tab of tabs) {
    tab.addEventListener("click", () =>
      deps.onFilter({ ...filter, tab: tab.dataset.tab as ThreadFilter["tab"] }),
    );
  }
  kindEl.addEventListener("change", () =>
    deps.onFilter({ ...filter, kind: kindEl.selectedIndex === 0 ? null : kindEl.value }),
  );
  rowsEl.addEventListener("click", (e) => {
    const id = (e.target as Element).closest<HTMLElement>("[data-id]")?.dataset.id;
    if (id !== undefined) deps.onSelect(id);
  });

  function focusSelected(): void {
    rowsEl.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }

  function emptyText(view: ThreadListView): string {
    if (view.kind !== null) {
      const source = threadSource(view.kind).name;
      return t(filter.tab === "waiting" ? "threads.empty_kind_waiting" : "threads.empty_kind_all", {
        source,
      });
    }
    return t(filter.tab === "waiting" ? "threads.empty_waiting" : "threads.empty_all");
  }

  return {
    el,
    render(view, next, selected, now) {
      filter = next;
      el.setAttribute("aria-label", t("threads.list_aria"));
      for (const tab of tabs) {
        const isWaiting = tab.dataset.tab === "waiting";
        const count = document.createElement("span");
        count.className = "yui-threads-list__count";
        count.textContent = String(isWaiting ? view.counts.waiting : view.counts.all);
        tab.replaceChildren(t(isWaiting ? "threads.tab_waiting" : "threads.tab_all"), count);
        tab.setAttribute("aria-pressed", String(tab.dataset.tab === filter.tab));
      }
      kindEl.setAttribute("aria-label", t("threads.kind"));
      const inTab = view.kinds.reduce((n, k) => n + k.count, 0);
      kindEl.replaceChildren(
        new Option(t("threads.kind_all", { n: inTab }), ""),
        ...view.kinds.map((k) => {
          const option = new Option(`${threadSource(k.source).name} (${k.count})`, k.source);
          option.disabled = k.disabled;
          return option;
        }),
      );
      kindEl.selectedIndex =
        view.kind === null ? 0 : view.kinds.findIndex((k) => k.source === view.kind) + 1;

      const hadFocus = rowsEl.contains(document.activeElement);
      if (view.rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "yui-threads-list__empty";
        empty.textContent = emptyText(view);
        rowsEl.replaceChildren(empty);
      } else {
        rowsEl.replaceChildren(...view.rows.map((th) => row(th, th.id === selected, now)));
      }
      if (hadFocus) focusSelected();
    },
    focusSelected,
  };
}
