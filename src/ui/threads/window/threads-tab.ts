/**
 * The Threads tab: the list pane or its rail beside the thread pane, kept on the newest snapshot.
 * The selection and the filters survive snapshots; the thread pane keeps each ask's draft.
 */

import type { AskAnswer, Thread, ThreadsSnapshot } from "../../../contract";
import { isWaiting } from "../../../io/threads/threads-waiting";
import { subscribe as subscribeLocale, t } from "../../i18n";
import {
  createThreadList,
  nextWaiting,
  openSelection,
  type ThreadFilter,
  threadListView,
} from "./thread-list";
import { createThreadPane } from "./thread-pane";
import { createThreadRail } from "./thread-rail";
import type { TabBody, TabShell } from "./threads-tabs";

export interface ThreadsTabBody extends TabBody {
  update(snapshot: ThreadsSnapshot): void;
  /** An open starts on the Waiting filter and the Thread it shows, or on `thread` and the filter that holds it once a snapshot has it; never reported seen. */
  reset(thread?: string): void;
}

export function createThreadsTab(deps: {
  shell: TabShell;
  now(): number;
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: AskAnswer): Promise<void>;
  /** The user picked a Thread whose open ask has not been reported seen. */
  onSeen(id: string, askId: string): void;
  /** The user marked the Thread read. */
  onRead(id: string): void;
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
    onRead: deps.onRead,
  });

  let threads: Thread[] = [];
  let filter: ThreadFilter = { tab: "waiting", kind: null };
  let selected: string | null = null;
  let rows: Thread[] = [];
  let waiting = 0;
  // The Thread an open asked for and the snapshot does not hold yet.
  let wanted: string | null = null;

  function applyWanted(): boolean {
    const asked = threads.find((th) => th.id === wanted);
    if (!asked) return false;
    wanted = null;
    selected = asked.id;
    filter = { tab: isWaiting(asked) ? "waiting" : "all", kind: null };
    return true;
  }

  function select(id: string): void {
    wanted = null;
    selected = id;
    const picked = threads.find((th) => th.id === id);
    if (picked?.ask && picked.seen_ask_id !== picked.ask.ask_id) deps.onSeen(id, picked.ask.ask_id);
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
    // A hidden transcript reads no scroll position, so the pane redraws when its tab shows.
    if (!el.hidden) pane.show(threads.find((th) => th.id === selected));
    shell.headChanged();
  }

  const offLocale = subscribeLocale(render);
  render();

  return {
    el,
    list: list.el,
    update(snapshot) {
      const before = threads.find((th) => th.id === selected);
      threads = snapshot.threads;
      pane.prune(threads);
      const marked = before && !before.read && threads.find((th) => th.id === selected)?.read;
      const hadFocus = marked && paneEl.contains(document.activeElement);
      if (!applyWanted() && marked && selected) selected = nextWaiting(rows, threads, selected);
      render();
      // The rebuild removed the Mark read button that held focus.
      if (hadFocus) paneEl.querySelector("h2")?.focus();
    },
    reset(thread) {
      pane.restart();
      filter = { tab: "waiting", kind: null };
      selected = openSelection(threads);
      wanted = thread ?? null;
      applyWanted();
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
      wanted = null;
      selected = next.id;
      render();
      shell.focusSelected();
    },
    pick: pane.pick,
    focusField: pane.focusField,
    shown: render,
    dispose: offLocale,
  };
}
