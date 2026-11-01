/**
 * The Threads window's view: a Threads and a Terminal tab under one head, each with the list pane
 * or its rail beside its pane, laid out by the panel's width. The Threads tab keeps the newest
 * snapshot; its selection and filters survive snapshots, and the thread pane keeps each ask's draft.
 */

import "./threads-view.css";
import type { ScreenRect, Thread, ThreadsSnapshot } from "../../../contract";
import type { ThreadsTab } from "../../../io/bridge/settings-bridge";
import { subscribe as subscribeLocale, t } from "../../i18n";
import { CROSS_SVG } from "../../quick-controls/constants";
import { growOpen, shrinkClose } from "./grow";
import { refreshTimes } from "./relative-time";
import { attachResizeHandles, type ResizeListener } from "./resize-handles";
import { createThreadList, openSelection, type ThreadFilter, threadListView } from "./thread-list";
import { createThreadPane } from "./thread-pane";
import { createThreadRail } from "./thread-rail";
import { attachThreadsKeys } from "./threads-keys";
import { createThreadsLayout } from "./threads-layout";
import { createThreadsTabs } from "./threads-tabs";

const SIDEBAR_SVG =
  '<svg class="yui-threads-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';
/** The list pane's id, which the head's toggle controls. */
const LIST_ID = "yui-threads-list";

/** How often the relative times are redrawn. */
const REFRESH_MS = 60_000;

/** What the view hands the Terminal tab's body. */
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

/** The Terminal tab's body, laid out and keyed like the Threads tab's. */
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
  /** Its tab became the shown one. */
  shown(): void;
  dispose(): void;
}

export interface ThreadsView {
  update(snapshot: ThreadsSnapshot): void;
  /** Shows `tab` (Threads by default), resets the filters, selects the Thread an open shows, and grows out of `from` (window-local px) when there is one. */
  open(from: ScreenRect | null, tab?: ThreadsTab): Promise<void>;
  /** Shows `tab`, keeping everything else. */
  select(tab: ThreadsTab): void;
  /** Shrinks back to where the last open grew from. */
  close(): Promise<void>;
  /** The head is the window's drag handle; its × keeps its click. */
  onHeadPointerDown(cb: (event: PointerEvent) => void): () => void;
  dispose(): void;
}

export function createThreadsView(deps: {
  mount: HTMLElement;
  now(): number;
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: { choice?: string; text?: string }): Promise<void>;
  onClose(): void;
  /** The stored choice of the list collapsed to the rail. */
  listCollapsed: boolean;
  onListCollapsed(collapsed: boolean): void;
  /** The panel's edge and corner drags. */
  resize: ResizeListener;
  terminal?(shell: TabShell): TabBody;
}): ThreadsView {
  const root = document.createElement("div");
  root.className = "yui-threads";
  root.innerHTML = `
    <section class="yui-threads__panel">
      <div class="yui-threads__content">
        <header class="yui-threads__head">
          <button type="button" class="yui-threads__toggle" aria-controls="${LIST_ID}"
            aria-keyshortcuts="Control+Meta+S">${SIDEBAR_SVG}</button>
          <span class="yui-threads__count"></span>
          <button type="button" class="yui-threads__close">${CROSS_SVG}</button>
        </header>
        <div class="yui-threads__panes" id="yui-threads-panel-threads" role="tabpanel"
          aria-labelledby="yui-threads-tab-threads"><article class="yui-threads-pane"></article></div>
      </div>
    </section>
  `;
  deps.mount.append(root);
  const panel = root.querySelector<HTMLElement>(".yui-threads__panel")!;
  const content = root.querySelector<HTMLElement>(".yui-threads__content")!;
  const countEl = root.querySelector<HTMLElement>(".yui-threads__count")!;
  const headEl = root.querySelector<HTMLElement>(".yui-threads__head")!;
  const closeEl = root.querySelector<HTMLButtonElement>(".yui-threads__close")!;
  const toggleEl = root.querySelector<HTMLButtonElement>(".yui-threads__toggle")!;
  const panesEl = root.querySelector<HTMLElement>(".yui-threads__panes")!;
  const paneEl = root.querySelector<HTMLElement>(".yui-threads-pane")!;
  const backEl = document.createElement("button");
  backEl.type = "button";
  backEl.className = "yui-threads-pane__back";
  const pane = createThreadPane({
    el: paneEl,
    back: backEl,
    now: deps.now,
    onAnswer: deps.onAnswer,
  });

  let threads: Thread[] = [];
  let filter: ThreadFilter = { tab: "waiting", kind: null };
  let selected: string | null = null;
  let rows: Thread[] = [];
  let from: ScreenRect | null = null;
  let tab: ThreadsTab = "threads";
  let waitingCount = 0;

  function select(id: string): void {
    selected = id;
    const listHid = layout.selected();
    render();
    if (listHid) paneEl.querySelector("h2")?.focus();
  }
  function setFilter(next: ThreadFilter): void {
    filter = next;
    render();
  }
  const list = createThreadList({ onSelect: select, onFilter: setFilter });
  const rail = createThreadRail({ onSelect: select, onFilter: setFilter });
  list.el.id = LIST_ID;
  paneEl.before(list.el, rail.el);
  const tabs = createThreadsTabs({ onSelect: (next) => showTab(next) });
  toggleEl.after(tabs.el);
  const terminalBack = document.createElement("button");
  terminalBack.type = "button";
  terminalBack.className = "yui-threads-pane__back";
  const terminal = deps.terminal?.({
    back: terminalBack,
    selected: () => layout.selected(),
    focusSelected: () => layout.focusSelected(),
    headChanged: () => renderHead(),
  });
  if (terminal) {
    terminal.el.id = "yui-threads-panel-terminal";
    terminal.el.setAttribute("role", "tabpanel");
    terminal.el.setAttribute("aria-labelledby", "yui-threads-tab-terminal");
    terminal.el.hidden = true;
    content.append(terminal.el);
  }
  const onTerminal = (): boolean => tab === "terminal" && terminal !== undefined;
  const layout = createThreadsLayout({
    panel,
    lists: terminal ? [list.el, terminal.list] : [list.el],
    toggle: toggleEl,
    backs: [backEl, terminalBack],
    collapsed: deps.listCollapsed,
    onCollapsed: deps.onListCollapsed,
    focusList: () => (onTerminal() ? terminal!.focusList() : list.focusSelected()),
    focusRail: () => (onTerminal() ? terminal!.focusRail() : rail.focusSelected()),
  });

  function renderHead(): void {
    const head = terminal?.head() ?? { count: "", waiting: false };
    tabs.render(tab, { threads: waitingCount > 0, terminal: head.waiting });
    countEl.textContent =
      tab === "threads" ? t("threads.waiting_count", { n: waitingCount }) : head.count;
  }

  function showTab(next: ThreadsTab): void {
    tab = next;
    panesEl.hidden = tab !== "threads";
    if (terminal) terminal.el.hidden = tab !== "terminal";
    layout.reset(tab === "threads" ? selected !== null : (terminal?.hasSelection() ?? false));
    renderHead();
    if (onTerminal()) terminal!.shown();
  }

  function renderList(): void {
    const view = threadListView(threads, filter);
    filter = { ...filter, kind: view.kind };
    rows = view.rows;
    if (!threads.some((th) => th.id === selected)) selected = rows[0]?.id ?? openSelection(threads);
    list.render(view, filter, selected, deps.now());
    rail.render(view, filter, selected);
    waitingCount = view.counts.waiting;
    renderHead();
    const sidebar = t("threads.sidebar");
    toggleEl.setAttribute("aria-label", sidebar);
    toggleEl.title = `${sidebar} (⌃⌘S)`;
    backEl.textContent = t("threads.back");
    terminalBack.textContent = t("threads.back");
    closeEl.setAttribute("aria-label", t("threads.close"));
    panel.setAttribute("aria-label", t("threads.window_aria"));
    paneEl.setAttribute("aria-label", t("threads.pane_aria"));
  }

  function render(): void {
    renderList();
    pane.show(threads.find((th) => th.id === selected));
  }

  const offKeys = attachThreadsKeys({
    onToggleList: layout.toggle,
    onEscape: () => {
      if (!layout.escape()) deps.onClose();
    },
    onPick: (index) => {
      if (tab === "threads") pane.pick(index);
    },
    onMove: (delta) => {
      if (onTerminal()) {
        terminal!.move(delta);
        return;
      }
      const at = rows.findIndex((th) => th.id === selected);
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + delta))];
      if (!next) return;
      selected = next.id;
      render();
      layout.focusSelected();
    },
  });
  closeEl.addEventListener("click", deps.onClose);
  const headListeners = new Set<(event: PointerEvent) => void>();
  headEl.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("button")) return;
    for (const cb of headListeners) cb(event);
  });
  const offHandles = attachResizeHandles({ panel, listener: deps.resize });
  const offLocale = subscribeLocale(render);
  const refresh = setInterval(() => refreshTimes(root, deps.now()), REFRESH_MS);
  render();

  return {
    update(snapshot) {
      threads = snapshot.threads;
      pane.prune(threads);
      render();
    },
    async open(at, next = "threads") {
      from = at;
      filter = { tab: "waiting", kind: null };
      selected = openSelection(threads);
      render();
      showTab(next);
      await growOpen({ root, panel, content }, at);
      if (tab === "terminal" || !pane.focusField()) layout.focusSelected();
    },
    select(next) {
      if (next !== tab) showTab(next);
    },
    close: () => shrinkClose({ root, panel, content }, from),
    onHeadPointerDown(cb) {
      headListeners.add(cb);
      return () => headListeners.delete(cb);
    },
    dispose() {
      offKeys();
      terminal?.dispose();
      layout.dispose();
      offHandles();
      offLocale();
      clearInterval(refresh);
      root.remove();
    },
  };
}
