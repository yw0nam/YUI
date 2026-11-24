/**
 * The Threads tab's state: the list or its rail beside the thread pane, kept on the newest snapshot.
 * The selection and the filters survive snapshots; each publish commits before it returns, so a
 * focus handoff after it reaches the committed DOM.
 */

import { flushSync } from "react-dom";
import type { AskAnswer, Thread, ThreadsSnapshot } from "../../../contract";
import { isWaiting } from "../../../io/threads/threads-waiting";
import { t } from "../../i18n";
import type { TabShell, TabView } from "./tab-body";
import { createThreadAnswers, type ThreadAnswers } from "./thread-answers";
import {
  nextWaiting,
  openSelection,
  type ThreadFilter,
  type ThreadListView,
  threadListView,
} from "./thread-list-view";

export interface ThreadsTabState {
  threads: Thread[];
  view: ThreadListView;
  /** The filter in effect; its kind falls back to all kinds once that source left. */
  filter: ThreadFilter;
  selected: string | null;
  /** Counts the opens; each starts a fresh transcript. */
  opened: number;
  /** The time the rows and entries read. */
  now: number;
}

/** The DOM the tab's focus moves reach, in the committed view. */
export interface ThreadsTabFocus {
  heading(): void;
  /** Whether focus is inside the thread pane. */
  inPane(): boolean;
  list(): void;
  rail(): void;
}

export interface ThreadsTab extends TabView {
  current(): ThreadsTabState;
  subscribe(cb: () => void): () => void;
  answers: ThreadAnswers;
  update(snapshot: ThreadsSnapshot): void;
  /** An open starts on the Waiting filter and the Thread it shows, or on `thread` and the filter that holds it once a snapshot has it; never reported seen. */
  reset(thread?: string): void;
  select(id: string): void;
  setFilter(filter: ThreadFilter): void;
  /** Redraws the relative times. */
  tick(): void;
}

export function createThreadsTab(deps: {
  shell: Pick<TabShell, "selected" | "focusSelected" | "headChanged">;
  focus: ThreadsTabFocus;
  now(): number;
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: AskAnswer): Promise<void>;
  /** The user picked a Thread whose open ask has not been reported seen. */
  onSeen(id: string, askId: string): void;
}): ThreadsTab {
  const { shell, focus } = deps;
  const subscribers = new Set<() => void>();
  let threads: Thread[] = [];
  let filter: ThreadFilter = { tab: "waiting", kind: null };
  let selected: string | null = null;
  let opened = 0;
  // The Thread an open asked for and the snapshot does not hold yet.
  let wanted: string | null = null;
  let state: ThreadsTabState;
  const answers = createThreadAnswers({ onAnswer: deps.onAnswer, changed: render });

  function applyWanted(): boolean {
    const asked = threads.find((th) => th.id === wanted);
    if (!asked) return false;
    wanted = null;
    selected = asked.id;
    filter = { tab: isWaiting(asked) ? "waiting" : "all", kind: null };
    return true;
  }

  function compute(): void {
    const view = threadListView(threads, filter);
    filter = { ...filter, kind: view.kind };
    if (!threads.some((th) => th.id === selected))
      selected = view.rows[0]?.id ?? openSelection(threads);
    state = { threads, view, filter, selected, opened, now: deps.now() };
  }

  function render(): void {
    compute();
    flushSync(() => {
      for (const cb of subscribers) cb();
      shell.headChanged();
    });
  }

  compute();

  return {
    current: () => state,
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    answers,
    update(snapshot) {
      const before = threads.find((th) => th.id === selected);
      threads = snapshot.threads;
      answers.prune(threads);
      const marked = before && !before.read && threads.find((th) => th.id === selected)?.read;
      const hadFocus = marked && focus.inPane();
      if (!applyWanted() && marked && selected)
        selected = nextWaiting(state.view.rows, threads, selected);
      render();
      // The redraw removed the Mark read button that held focus.
      if (hadFocus) focus.heading();
    },
    reset(thread) {
      opened += 1;
      filter = { tab: "waiting", kind: null };
      selected = openSelection(threads);
      wanted = thread ?? null;
      applyWanted();
      render();
    },
    select(id) {
      wanted = null;
      selected = id;
      const picked = threads.find((th) => th.id === id);
      if (picked?.ask && picked.seen_ask_id !== picked.ask.ask_id)
        deps.onSeen(id, picked.ask.ask_id);
      const listHid = shell.selected();
      render();
      if (listHid) focus.heading();
    },
    setFilter(next) {
      filter = next;
      render();
    },
    tick: render,
    head() {
      const waiting = state.view.counts.waiting;
      return { count: t("threads.waiting_count", { n: waiting }), waiting: waiting > 0 };
    },
    hasSelection: () => selected !== null,
    focusList: focus.list,
    focusRail: focus.rail,
    move(delta) {
      const rows = state.view.rows;
      const at = rows.findIndex((th) => th.id === selected);
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + delta))];
      if (!next) return;
      wanted = null;
      selected = next.id;
      render();
      shell.focusSelected();
    },
    pick: answers.pick,
    focusField: answers.focusField,
    shown: render,
  };
}
