/**
 * The Threads window's view: the list pane or its rail beside the thread pane, laid out by the
 * panel's width, kept on the newest snapshot. The selection and the filters survive snapshots; the
 * thread pane keeps each ask's draft.
 */

import "./threads-view.css";
import type { ScreenRect, Thread, ThreadsSnapshot } from "../../../contract";
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

const SIDEBAR_SVG =
  '<svg class="yui-threads-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';
/** The list pane's id, which the head's toggle controls. */
const LIST_ID = "yui-threads-list";

/** How often the relative times are redrawn. */
const REFRESH_MS = 60_000;

export interface ThreadsView {
  update(snapshot: ThreadsSnapshot): void;
  /** Resets the filters, selects the Thread an open shows, and grows out of `from` (window-local px). */
  open(from: ScreenRect): Promise<void>;
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
}): ThreadsView {
  const root = document.createElement("div");
  root.className = "yui-threads";
  root.innerHTML = `
    <section class="yui-threads__panel">
      <div class="yui-threads__content">
        <header class="yui-threads__head">
          <button type="button" class="yui-threads__toggle" aria-controls="${LIST_ID}"
            aria-keyshortcuts="Control+Meta+S">${SIDEBAR_SVG}</button>
          <h1></h1>
          <span class="yui-threads__count"></span>
          <button type="button" class="yui-threads__close">${CROSS_SVG}</button>
        </header>
        <div class="yui-threads__panes"><article class="yui-threads-pane"></article></div>
      </div>
    </section>
  `;
  deps.mount.append(root);
  const panel = root.querySelector<HTMLElement>(".yui-threads__panel")!;
  const content = root.querySelector<HTMLElement>(".yui-threads__content")!;
  const titleEl = root.querySelector("h1")!;
  const countEl = root.querySelector<HTMLElement>(".yui-threads__count")!;
  const headEl = root.querySelector<HTMLElement>(".yui-threads__head")!;
  const closeEl = root.querySelector<HTMLButtonElement>(".yui-threads__close")!;
  const toggleEl = root.querySelector<HTMLButtonElement>(".yui-threads__toggle")!;
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
  let from: ScreenRect = { x: 0, y: 0, width: 0, height: 0 };

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
  const layout = createThreadsLayout({
    panel,
    list: list.el,
    toggle: toggleEl,
    back: backEl,
    collapsed: deps.listCollapsed,
    onCollapsed: deps.onListCollapsed,
    focusList: list.focusSelected,
    focusRail: rail.focusSelected,
  });

  function renderList(): void {
    const view = threadListView(threads, filter);
    filter = { ...filter, kind: view.kind };
    rows = view.rows;
    if (!threads.some((th) => th.id === selected)) selected = rows[0]?.id ?? openSelection(threads);
    list.render(view, filter, selected, deps.now());
    rail.render(view, filter, selected);
    titleEl.textContent = t("threads.title");
    const sidebar = t("threads.sidebar");
    toggleEl.setAttribute("aria-label", sidebar);
    toggleEl.title = `${sidebar} (⌃⌘S)`;
    backEl.textContent = t("threads.back");
    countEl.textContent = t("threads.waiting_count", { n: view.counts.waiting });
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
    onPick: pane.pick,
    onMove: (delta) => {
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
    async open(at) {
      from = at;
      filter = { tab: "waiting", kind: null };
      selected = openSelection(threads);
      layout.reset(selected !== null);
      render();
      await growOpen({ root, panel, content }, at);
      if (!pane.focusField()) layout.focusSelected();
    },
    close: () => shrinkClose({ root, panel, content }, from),
    onHeadPointerDown(cb) {
      headListeners.add(cb);
      return () => headListeners.delete(cb);
    },
    dispose() {
      offKeys();
      layout.dispose();
      offHandles();
      offLocale();
      clearInterval(refresh);
      root.remove();
    },
  };
}
