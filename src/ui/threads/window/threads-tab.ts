/**
 * The Threads tab: the list pane or its rail beside the thread pane, kept on the newest snapshot.
 * The selection and the filters survive snapshots; the thread pane keeps each ask's draft.
 */

import type { Thread, ThreadsSnapshot } from "../../../contract";
import { subscribe as subscribeLocale, t } from "../../i18n";
import { createThreadList, openSelection, type ThreadFilter, threadListView } from "./thread-list";
import { createThreadPane } from "./thread-pane";
import { createThreadRail } from "./thread-rail";
import type { TabBody, TabShell } from "./threads-tabs";

export interface ThreadsTabBody extends TabBody {
  update(snapshot: ThreadsSnapshot): void;
  /** An open starts on the Waiting filter and the Thread it shows. */
  reset(): void;
}

export function createThreadsTab(deps: {
  shell: TabShell;
  now(): number;
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: { choice?: string; text?: string }): Promise<void>;
}): ThreadsTabBody {
  const { shell } = deps;
  const el = document.createElement("div");
  el.className = "yui-threads__panes";
  const paneEl = document.createElement("article");
  paneEl.className = "yui-threads-pane";
  const pane = createThreadPane({
    el: paneEl,
    back: shell.back,
    now: deps.now,
    onAnswer: deps.onAnswer,
  });

  let threads: Thread[] = [];
  let filter: ThreadFilter = { tab: "waiting", kind: null };
  let selected: string | null = null;
  let rows: Thread[] = [];
  let waiting = 0;

  function select(id: string): void {
    selected = id;
    const listHid = shell.selected();
    render();
    if (listHid) paneEl.querySelector("h2")?.focus();
  }
  function setFilter(next: ThreadFilter): void {
    filter = next;
    render();
  }
  const list = createThreadList({ onSelect: select, onFilter: setFilter });
  const rail = createThreadRail({ onSelect: select, onFilter: setFilter });
  el.append(list.el, rail.el, paneEl);

  function render(): void {
    const view = threadListView(threads, filter);
    filter = { ...filter, kind: view.kind };
    rows = view.rows;
    if (!threads.some((th) => th.id === selected)) selected = rows[0]?.id ?? openSelection(threads);
    list.render(view, filter, selected, deps.now());
    rail.render(view, filter, selected);
    waiting = view.counts.waiting;
    shell.back.textContent = t("threads.back");
    paneEl.setAttribute("aria-label", t("threads.pane_aria"));
    pane.show(threads.find((th) => th.id === selected));
    shell.headChanged();
  }

  const offLocale = subscribeLocale(render);
  render();

  return {
    el,
    list: list.el,
    update(snapshot) {
      threads = snapshot.threads;
      pane.prune(threads);
      render();
    },
    reset() {
      filter = { tab: "waiting", kind: null };
      selected = openSelection(threads);
      render();
    },
    head: () => ({ count: t("threads.waiting_count", { n: waiting }), waiting: waiting > 0 }),
    hasSelection: () => selected !== null,
    focusList: list.focusSelected,
    focusRail: rail.focusSelected,
    move(delta) {
      const at = rows.findIndex((th) => th.id === selected);
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + delta))];
      if (!next) return;
      selected = next.id;
      render();
      shell.focusSelected();
    },
    pick: pane.pick,
    focusField: pane.focusField,
    shown() {},
    dispose: offLocale,
  };
}
