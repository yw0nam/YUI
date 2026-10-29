/**
 * The Threads window's view: the list pane beside the thread pane, kept on the newest snapshot.
 * The selection, the filters, and each ask's unsent draft survive snapshots; a draft goes with
 * its ask.
 */

import "./threads-view.css";
import type { ScreenRect, Thread, ThreadsSnapshot } from "../../../contract";
import { getLocale, subscribe as subscribeLocale, t } from "../../i18n";
import { CROSS_SVG } from "../../quick-controls/constants";
import { type AnswerArea, createAnswerArea } from "./answer-area";
import { type Draft, draftKey, pruneDrafts } from "./drafts";
import { growOpen, shrinkClose } from "./grow";
import { createThreadList, openSelection, type ThreadFilter, threadListView } from "./thread-list";
import { threadPane } from "./thread-pane";
import { attachThreadsKeys } from "./threads-keys";

/** How often the list's relative times are redrawn. */
const REFRESH_MS = 60_000;

export interface ThreadsView {
  update(snapshot: ThreadsSnapshot): void;
  /** Resets the filters, selects the Thread an open shows, and grows out of `from` (window-local px). */
  open(from: ScreenRect): Promise<void>;
  /** Shrinks back to where the last open grew from. */
  close(): Promise<void>;
  dispose(): void;
}

export function createThreadsView(deps: {
  mount: HTMLElement;
  now(): number;
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: { choice?: string; text?: string }): Promise<void>;
  onClose(): void;
}): ThreadsView {
  const root = document.createElement("div");
  root.className = "yui-threads";
  root.innerHTML = `
    <section class="yui-threads__panel">
      <div class="yui-threads__content">
        <header class="yui-threads__head">
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
  const closeEl = root.querySelector<HTMLButtonElement>(".yui-threads__close")!;
  const pane = root.querySelector<HTMLElement>(".yui-threads-pane")!;

  let threads: Thread[] = [];
  let filter: ThreadFilter = { tab: "waiting", kind: null };
  let selected: string | null = null;
  let rows: Thread[] = [];
  let paneKey = "";
  let answerArea: AnswerArea | null = null;
  let from: ScreenRect = { x: 0, y: 0, width: 0, height: 0 };
  const drafts = new Map<string, Draft>();
  const errors = new Map<string, string>();

  const list = createThreadList({
    onSelect: (id) => {
      selected = id;
      render();
    },
    onFilter: (next) => {
      filter = next;
      render();
    },
  });
  pane.before(list.el);

  function renderList(): void {
    const view = threadListView(threads, filter);
    filter = { ...filter, kind: view.kind };
    rows = view.rows;
    if (!threads.some((th) => th.id === selected)) selected = rows[0]?.id ?? openSelection(threads);
    list.render(view, filter, selected, deps.now());
    titleEl.textContent = t("threads.title");
    countEl.textContent = t("threads.waiting_count", { n: view.counts.waiting });
    closeEl.setAttribute("aria-label", t("threads.close"));
    panel.setAttribute("aria-label", t("threads.window_aria"));
    pane.setAttribute("aria-label", t("threads.pane_aria"));
  }

  /** Rebuilt only when what it shows changed, so the field keeps its focus and caret. */
  function renderPane(): void {
    const thread = threads.find((th) => th.id === selected);
    const key = thread?.ask ? draftKey(thread.id, thread.ask.ask_id) : "";
    const next = thread
      ? [thread.id, thread.updated_at, errors.get(key) ?? "", getLocale()].join("\n")
      : "";
    if (next === paneKey) return;
    const sameThread = paneKey.split("\n")[0] === thread?.id;
    const scrollTop = pane.querySelector(".yui-threads-pane__transcript")?.scrollTop ?? 0;
    const hadFieldFocus = document.activeElement?.tagName === "TEXTAREA";
    paneKey = next;
    answerArea = null;
    if (!thread) {
      pane.replaceChildren();
      return;
    }
    const { head, transcript } = threadPane(thread, deps.now());
    pane.replaceChildren(head, transcript);
    if (sameThread) transcript.scrollTop = scrollTop;
    const ask = thread.ask;
    if (!ask) return;
    answerArea = createAnswerArea({
      ask,
      draft: drafts.get(key) ?? { text: "" },
      error: errors.get(key) ?? null,
      onDraft: (draft) => drafts.set(key, draft),
      onSend: (answer) => {
        errors.delete(key);
        deps.onAnswer(thread.id, ask.ask_id, answer).then(
          () => drafts.delete(key),
          (error) => {
            errors.set(key, String(error));
            paneKey = "";
            renderPane();
          },
        );
      },
    });
    pane.append(answerArea.el);
    if (hadFieldFocus) focusField();
  }

  function focusField(): void {
    const field = pane.querySelector("textarea");
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }

  function render(): void {
    renderList();
    renderPane();
  }

  const offKeys = attachThreadsKeys({
    onClose: deps.onClose,
    onPick: (index) => answerArea?.pick(index),
    onMove: (delta) => {
      const at = rows.findIndex((th) => th.id === selected);
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + delta))];
      if (!next) return;
      selected = next.id;
      render();
      list.focusSelected();
    },
  });
  closeEl.addEventListener("click", deps.onClose);
  const offLocale = subscribeLocale(render);
  const refresh = setInterval(renderList, REFRESH_MS);
  render();

  return {
    update(snapshot) {
      threads = snapshot.threads;
      pruneDrafts(drafts, threads);
      for (const key of errors.keys()) if (!drafts.has(key)) errors.delete(key);
      render();
    },
    async open(at) {
      from = at;
      filter = { tab: "waiting", kind: null };
      selected = openSelection(threads);
      render();
      await growOpen({ root, panel, content }, at);
      if (pane.querySelector("textarea")) focusField();
      else list.focusSelected();
    },
    close: () => shrinkClose({ root, panel, content }, from),
    dispose() {
      offKeys();
      offLocale();
      clearInterval(refresh);
      root.remove();
    },
  };
}
