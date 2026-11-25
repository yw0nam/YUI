/**
 * The Threads window's view: one head (the sidebar toggle, the Threads and Terminal tabs, the
 * count, Thread turns, ×) over the selected tab's body, laid out by the panel's width, grown out of the chip.
 */

import "./threads-view.css";
import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { AttachedThread, ScreenRect, ThreadsSnapshot } from "../../../contract";
import type { ThreadsOpen, ThreadsTab } from "../../../io/bridge/settings-bridge";
import type { ThreadTurnsLevel } from "../../../settings/threads/thread-turns-settings";
import type { TabsHandle } from "../../controls/tabs";
import { subscribe as subscribeLocale, t } from "../../i18n";
import { growOpen, shrinkClose } from "./grow";
import { hop } from "./hop";
import { createListSplitter } from "./list-splitter";
import { refreshTimes } from "./relative-time";
import { attachResizeHandles, type ResizeListener } from "./resize-handles";
import type { TabBody, TabShell, TabView } from "./tab-body";
import { THREADS_LIST_ID } from "./thread-list";
import type { AttachedSource } from "./thread-pane";
import { attachThreadsKeys } from "./threads-keys";
import { createThreadsLayout } from "./threads-layout";
import { createThreadsTab } from "./threads-tab";
import { threadsTabFocus } from "./threads-tab-view";
import { ThreadsWindow, type ThreadsWindowHandle } from "./threads-window";
import type { TurnsHandle, TurnsState } from "./turns-menu";

/** The Terminal tab's list id, which its list edge controls. */
const TERMINAL_LIST_ID = "yui-terminal-list";

/** How often the relative times are redrawn. */
const REFRESH_MS = 60_000;

export interface ThreadsView {
  update(snapshot: ThreadsSnapshot): void;
  /** Shows `tab` (Threads by default), resets the filters, selects `thread` or the Thread an open shows, grows out of `from` (window-local px) when there is one, and focuses the selected row unless `focus` is false. */
  open(
    from: ScreenRect | null,
    tab?: ThreadsTab,
    opts?: Pick<ThreadsOpen, "thread" | "focus">,
  ): Promise<void>;
  /** Shows `tab`, keeping everything else. */
  select(tab: ThreadsTab): void;
  /** Shrinks back to where the last open grew from. */
  close(): Promise<void>;
  /** Hops the panel inside its window, for a Thread reaction's raise. */
  hop(): Promise<void>;
  /** The head is the window's drag handle; its × keeps its click. */
  onHeadPointerDown(cb: (event: PointerEvent) => void): () => void;
  /** Draws the stored level on the head's Thread turns button. */
  setTurns(state: TurnsState): void;
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
  /** A level picked in the head's Thread turns menu. */
  onTurnsLevel(level: ThreadTurnsLevel): void;
  /** Main's attached Threads, which the pane's Attach to chat button reads. */
  attached: AttachedSource;
  /** The pane's Attach to chat button. */
  onAttach(thread: AttachedThread): void;
}): ThreadsView {
  const root = document.createElement("div");
  root.className = "yui-threads";
  root.innerHTML = `
    <section class="yui-threads__panel">
      <div class="yui-threads__content"></div>
    </section>
  `;
  deps.mount.append(root);
  const panel = root.querySelector<HTMLElement>(".yui-threads__panel")!;
  const content = root.querySelector<HTMLElement>(".yui-threads__content")!;
  let from: ScreenRect | null = null;
  const tabs = createRef<TabsHandle>();
  const turns = createRef<TurnsHandle>();
  const head = createRef<ThreadsWindowHandle>();
  const headListeners = new Set<(event: PointerEvent) => void>();

  const threadsPanel = createRef<HTMLDivElement>();
  const terminalBack = backButton();
  const shell = {
    selected: () => layout.selected(),
    focusSelected: () => layout.focusSelected(),
    headChanged: () => head.current?.headChanged(),
  };
  const threads = createThreadsTab({
    shell,
    focus: threadsTabFocus(threadsPanel),
    now: deps.now,
  });
  const terminal = deps.terminal({ ...shell, back: terminalBack });
  terminal.list.id = TERMINAL_LIST_ID;
  const bodies: Record<ThreadsTab, TabView> = { threads, terminal };
  const current = () => bodies[tabs.current!.selected() as ThreadsTab];

  const reactRoot = createRoot(content);
  flushSync(() =>
    reactRoot.render(
      createElement(ThreadsWindow, {
        bodies,
        threads,
        threadsPanel,
        terminal: terminal.el,
        tabs,
        turns,
        handle: head,
        onSelect: (tab) => {
          layout.reset(bodies[tab].hasSelection());
          bodies[tab].shown();
        },
        onRead: deps.onRead,
        onBack: () => layout.back(),
        onClose: deps.onClose,
        onHeadPointerDown: (event) => {
          for (const cb of headListeners) cb(event);
        },
        onTurnsLevel: deps.onTurnsLevel,
        attached: deps.attached,
        onAttach: deps.onAttach,
      }),
    ),
  );

  const threadsList = content.querySelector<HTMLElement>(`#${THREADS_LIST_ID}`)!;
  const toggle = content.querySelector<HTMLButtonElement>(".yui-threads__toggle")!;
  const splitter = createListSplitter({ panel, width: deps.listWidth, onWidth: deps.onListWidth });
  for (const list of [threadsList, terminal.list]) splitter.attach(list);
  const layout = createThreadsLayout({
    panel,
    lists: [threadsList, terminal.list],
    toggle,
    backs: [terminalBack],
    collapsed: deps.listCollapsed,
    onCollapsed: deps.onListCollapsed,
    focusList: () => current().focusList(),
    focusRail: () => current().focusRail(),
  });

  const offKeys = attachThreadsKeys({
    onToggleList: layout.toggle,
    onEscape: () => {
      if (turns.current!.isOpen()) turns.current!.close();
      else if (!layout.escape()) deps.onClose();
    },
    onMove: (delta) => {
      if (!turns.current!.isOpen()) current().move(delta);
    },
  });
  const offHandles = attachResizeHandles({ panel, listener: deps.resize });
  const label = () => panel.setAttribute("aria-label", t("threads.window_aria"));
  const offLocale = subscribeLocale(label);
  label();
  const refresh = setInterval(() => {
    refreshTimes(terminal.el, deps.now());
    threads.tick();
  }, REFRESH_MS);

  return {
    update: threads.update,
    async open(at, tab = "threads", opts = {}) {
      from = at;
      threads.reset(opts.thread);
      tabs.current!.select(tab);
      await growOpen({ root, panel, content }, at, { jelly: opts.focus === false });
      if (opts.focus !== false) layout.focusSelected();
    },
    select(tab) {
      if (tabs.current!.selected() !== tab) tabs.current!.select(tab);
    },
    close: () => shrinkClose({ root, panel, content }, from),
    hop: () => hop(panel),
    onHeadPointerDown(cb) {
      headListeners.add(cb);
      return () => headListeners.delete(cb);
    },
    setTurns: (state) => turns.current!.set(state),
    dispose() {
      offKeys();
      terminal.dispose();
      layout.dispose();
      splitter.dispose();
      offHandles();
      offLocale();
      clearInterval(refresh);
      reactRoot.unmount();
      root.remove();
    },
  };
}
