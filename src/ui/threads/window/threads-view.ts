/**
 * The Threads window's view: one head (the sidebar toggle, the Threads and Terminal tabs, the
 * count, ×) over the selected tab's body, laid out by the panel's width, grown out of the chip.
 */

import "./threads-view.css";
import type { AskAnswer, ScreenRect, ThreadsSnapshot } from "../../../contract";
import type { ThreadsTab } from "../../../io/bridge/settings-bridge";
import { subscribe as subscribeLocale, t } from "../../i18n";
import { CROSS_SVG } from "../../quick-controls/constants";
import { growOpen, shrinkClose } from "./grow";
import { createListSplitter } from "./list-splitter";
import { refreshTimes } from "./relative-time";
import { attachResizeHandles, type ResizeListener } from "./resize-handles";
import { attachThreadsKeys } from "./threads-keys";
import { createThreadsLayout } from "./threads-layout";
import { createThreadsTab } from "./threads-tab";
import { createThreadsTabs, type TabBody, type TabShell } from "./threads-tabs";

const SIDEBAR_SVG =
  '<svg class="yui-threads-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>';
/** The list pane's id, which the head's toggle controls. */
const LIST_ID = "yui-threads-list";
/** The Terminal tab's list id, which its list edge controls. */
const TERMINAL_LIST_ID = "yui-terminal-list";

/** How often the relative times are redrawn. */
const REFRESH_MS = 60_000;

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

function backButton(): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-threads-pane__back yui-threads-button";
  return el;
}

export function createThreadsView(deps: {
  mount: HTMLElement;
  now(): number;
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: AskAnswer): Promise<void>;
  onSeen(id: string, askId: string): void;
  onRead(id: string): void;
  onClose(): void;
  /** The stored choice of the list collapsed to the rail. */
  listCollapsed: boolean;
  onListCollapsed(collapsed: boolean): void;
  /** The stored list width; null for the default. */
  listWidth: number | null;
  onListWidth(width: number | null): void;
  /** The panel's edge and corner drags. */
  resize: ResizeListener;
  terminal(shell: TabShell): TabBody;
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
      </div>
    </section>
  `;
  deps.mount.append(root);
  const panel = root.querySelector<HTMLElement>(".yui-threads__panel")!;
  const content = root.querySelector<HTMLElement>(".yui-threads__content")!;
  const headEl = root.querySelector<HTMLElement>(".yui-threads__head")!;
  const closeEl = root.querySelector<HTMLButtonElement>(".yui-threads__close")!;
  const toggleEl = root.querySelector<HTMLButtonElement>(".yui-threads__toggle")!;
  let from: ScreenRect | null = null;

  const tabs = createThreadsTabs({
    count: root.querySelector<HTMLElement>(".yui-threads__count")!,
    onSwitch: (body) => layout.reset(body.hasSelection()),
  });
  toggleEl.after(tabs.el);
  const shell = (back: HTMLButtonElement): TabShell => ({
    back,
    selected: () => layout.selected(),
    focusSelected: () => layout.focusSelected(),
    headChanged: tabs.renderHead,
  });
  const backs = [backButton(), backButton()];
  const threads = createThreadsTab({
    shell: shell(backs[0]!),
    now: deps.now,
    onAnswer: deps.onAnswer,
    onSeen: deps.onSeen,
    onRead: deps.onRead,
  });
  const terminal = deps.terminal(shell(backs[1]!));
  threads.list.id = LIST_ID;
  terminal.list.id = TERMINAL_LIST_ID;
  const splitter = createListSplitter({ panel, width: deps.listWidth, onWidth: deps.onListWidth });
  for (const list of [threads.list, terminal.list]) splitter.attach(list);
  content.append(threads.el, terminal.el);
  tabs.add("threads", threads);
  tabs.add("terminal", terminal);
  const layout = createThreadsLayout({
    panel,
    lists: [threads.list, terminal.list],
    toggle: toggleEl,
    backs,
    collapsed: deps.listCollapsed,
    onCollapsed: deps.onListCollapsed,
    focusList: () => tabs.current().focusList(),
    focusRail: () => tabs.current().focusRail(),
  });

  function renderChrome(): void {
    const sidebar = t("threads.sidebar");
    toggleEl.setAttribute("aria-label", sidebar);
    toggleEl.title = `${sidebar} (⌃⌘S)`;
    closeEl.setAttribute("aria-label", t("threads.close"));
    panel.setAttribute("aria-label", t("threads.window_aria"));
  }

  const offKeys = attachThreadsKeys({
    onToggleList: layout.toggle,
    onEscape: () => {
      if (!layout.escape()) deps.onClose();
    },
    onPick: (index) => tabs.current().pick?.(index),
    onMove: (delta) => tabs.current().move(delta),
  });
  closeEl.addEventListener("click", deps.onClose);
  const headListeners = new Set<(event: PointerEvent) => void>();
  headEl.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("button")) return;
    for (const cb of headListeners) cb(event);
  });
  const offHandles = attachResizeHandles({ panel, listener: deps.resize });
  const offLocale = subscribeLocale(renderChrome);
  const refresh = setInterval(() => refreshTimes(root, deps.now()), REFRESH_MS);
  renderChrome();

  return {
    update: threads.update,
    async open(at, tab = "threads") {
      from = at;
      threads.reset();
      tabs.select(tab);
      await growOpen({ root, panel, content }, at);
      if (!tabs.current().focusField?.()) layout.focusSelected();
    },
    select: tabs.show,
    close: () => shrinkClose({ root, panel, content }, from),
    onHeadPointerDown(cb) {
      headListeners.add(cb);
      return () => headListeners.delete(cb);
    },
    dispose() {
      offKeys();
      threads.dispose();
      terminal.dispose();
      layout.dispose();
      splitter.dispose();
      offHandles();
      offLocale();
      clearInterval(refresh);
      root.remove();
    },
  };
}
