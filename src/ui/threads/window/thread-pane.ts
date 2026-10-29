/** The thread pane's head and transcript; the transcript scrolls on its own above the answer area. */

import "./thread-pane.css";
import type { Thread, ThreadEntry } from "../../../contract";
import { t } from "../../i18n";
import { threadSource } from "../thread-source";
import { relativeTime } from "./relative-time";
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
  const time = document.createElement("time");
  time.textContent = relativeTime(entry.at, now);
  head.append(speaker(entry, source), time);
  const text = document.createElement("div");
  text.className = "yui-threads-entry__text";
  text.append(richText(entry.text));
  el.append(head, text);
  return el;
}

/** The pane's head and its scrolling transcript. */
export function threadPane(
  thread: Thread,
  now: number,
): { head: HTMLElement; transcript: HTMLElement } {
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
