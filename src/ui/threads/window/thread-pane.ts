/**
 * The thread pane: its head, the transcript that scrolls on its own, and the answer area pinned
 * under it. It keeps each ask's draft, send error, and in-flight send, and rebuilds only when what
 * it shows changed, so the field keeps its focus and caret.
 */

import "./thread-pane.css";
import type { Thread, ThreadEntry } from "../../../contract";
import { getLocale, t } from "../../i18n";
import { threadSource } from "../thread-source";
import { type AnswerArea, createAnswerArea } from "./answer-area";
import { type Draft, draftKey, pruneDrafts } from "./drafts";
import { timeEl } from "./relative-time";
import { richText } from "./rich-text";
import { sourceLine, stateWord } from "./thread-meta";

function speaker(entry: ThreadEntry, source: string): string {
  if (entry.role === "user") return t("threads.role_user");
  if (entry.role === "system") return t("threads.role_system");
  return threadSource(source).name;
}

function entryEl(entry: ThreadEntry, source: string, now: number): HTMLElement {
  const el = document.createElement("section");
  el.className = `yui-threads-entry is-${entry.role}`;
  const head = document.createElement("div");
  head.className = "yui-threads-entry__head";
  head.append(speaker(entry, source), timeEl(entry.at, now));
  const text = document.createElement("div");
  text.className = "yui-threads-entry__text";
  text.append(richText(entry.text));
  el.append(head, text);
  return el;
}

function threadPane(thread: Thread, now: number): { head: HTMLElement; transcript: HTMLElement } {
  const head = document.createElement("header");
  head.className = "yui-threads-pane__head";
  const line = document.createElement("div");
  line.className = "yui-threads-pane__line";
  line.append(sourceLine(thread.source), stateWord(thread));
  const title = document.createElement("h2");
  title.tabIndex = -1;
  title.textContent = thread.title;
  head.append(line, title);
  if (thread.label) {
    const label = document.createElement("p");
    label.className = "yui-threads-pane__label";
    label.textContent = thread.label;
    head.append(label);
  }
  const transcript = document.createElement("div");
  transcript.className = "yui-threads-pane__transcript";
  transcript.append(...thread.entries.map((entry) => entryEl(entry, thread.source, now)));
  return { head, transcript };
}

export interface ThreadPane {
  /** Shows `thread`, or nothing. */
  show(thread: Thread | undefined): void;
  /** Drops the drafts and errors of asks no longer open in `threads`. */
  prune(threads: Thread[]): void;
  /** Toggles the open ask's choice at `index`. */
  pick(index: number): void;
  /** Focuses the answer field with the caret at its end; false when there is none. */
  focusField(): boolean;
}

export function createThreadPane(deps: {
  el: HTMLElement;
  /** The narrow layout's way back to the list, leading the pane's head. */
  back: HTMLElement;
  now(): number;
  /** Rejects with the store's error string. */
  onAnswer(id: string, askId: string, answer: { choice?: string; text?: string }): Promise<void>;
}): ThreadPane {
  const { el } = deps;
  const drafts = new Map<string, Draft>();
  const errors = new Map<string, string>();
  // Kept outside the answer area, so a rebuild mid-send never enables a second send.
  const sending = new Set<string>();
  let current: Thread | undefined;
  // What the pane shows; a change in any part of the key rebuilds it.
  let shownKey: string | null = null;
  let shownId: string | undefined;
  let area: AnswerArea | null = null;

  function focusField(): boolean {
    const field = el.querySelector("textarea");
    if (!field) return false;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    return true;
  }

  function show(thread: Thread | undefined): void {
    current = thread;
    const key = thread?.ask ? draftKey(thread.id, thread.ask.ask_id) : "";
    const next = thread
      ? JSON.stringify([
          thread.id,
          thread.updated_at,
          errors.get(key) ?? null,
          sending.has(key),
          getLocale(),
        ])
      : null;
    if (next === shownKey) return;
    const sameThread = shownId === thread?.id;
    const scrollTop = el.querySelector(".yui-threads-pane__transcript")?.scrollTop ?? 0;
    const hadFieldFocus = document.activeElement?.tagName === "TEXTAREA";
    shownKey = next;
    shownId = thread?.id;
    area = null;
    if (!thread) {
      el.replaceChildren();
      return;
    }
    const { head, transcript } = threadPane(thread, deps.now());
    head.prepend(deps.back);
    el.replaceChildren(head, transcript);
    if (sameThread) transcript.scrollTop = scrollTop;
    const ask = thread.ask;
    if (!ask) return;
    area = createAnswerArea({
      ask,
      draft: drafts.get(key) ?? { text: "" },
      error: errors.get(key) ?? null,
      sending: sending.has(key),
      onDraft: (draft) => drafts.set(key, draft),
      onSend: (answer) => {
        errors.delete(key);
        sending.add(key);
        show(current);
        // The ask id is the one this send answers, so a late result never touches a newer ask.
        deps.onAnswer(thread.id, ask.ask_id, answer).then(
          () => {
            sending.delete(key);
            drafts.delete(key);
            show(current);
          },
          (error) => {
            sending.delete(key);
            errors.set(key, String(error));
            show(current);
          },
        );
      },
    });
    el.append(area.el);
    if (hadFieldFocus) focusField();
  }

  return {
    show,
    prune(threads) {
      pruneDrafts(drafts, threads);
      for (const key of errors.keys()) if (!drafts.has(key)) errors.delete(key);
    },
    pick: (index) => area?.pick(index),
    focusField,
  };
}
