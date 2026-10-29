/** The text of a Threads tool result: the Thread rows, one Thread's conversation, and a search snippet. */

import type { Thread, ThreadAsk, ThreadEntry } from "../../../../contract";

const LIST_LIMIT = 20;
const SEARCH_LIMIT = 10;
const LAST_CUT = 160;
const ENTRY_CUT = 2000;
/** The chars a search snippet shows on each side of the match. */
const SNIPPET_SIDE = 80;

/** Collapses whitespace runs to one space and strips the client_context tags, so a producer string cannot forge a line or close the block. */
function oneLine(text: string): string {
  return text
    .replace(/<\/?client_context>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Local wall-clock `YYYY-MM-DD HH:MM`; the turn's `time:` line tells the backend the timezone. */
function localTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function row(thread: Thread): string {
  return [
    oneLine(thread.id),
    oneLine(thread.source),
    oneLine(thread.title),
    thread.label ? oneLine(thread.label) : "-",
    thread.state,
    localTime(thread.updated_at),
  ].join(" | ");
}

function asksPrompt(thread: Thread): string | undefined {
  return thread.ask ? `  asks: ${oneLine(thread.ask.prompt)}` : undefined;
}

function lastLine(thread: Thread): string | undefined {
  const last = thread.entries.at(-1);
  if (!last) return undefined;
  return `  last: ${last.role}: ${oneLine(last.text).slice(0, LAST_CUT)}`;
}

/** The threads_list result without an id: rows for the newest Threads, then the count cut away. */
export function listText(threads: Thread[]): string {
  if (threads.length === 0) return "no threads";
  const shown = threads.slice(0, LIST_LIMIT);
  const lines = shown.flatMap((thread) =>
    [row(thread), asksPrompt(thread), lastLine(thread)].filter(
      (line): line is string => line !== undefined,
    ),
  );
  const rest = threads.length - shown.length;
  return rest > 0 ? [...lines, `(${rest} more)`].join("\n") : lines.join("\n");
}

/** An entry's text cut at the char cap, keeping its newlines. */
function entryText(entry: ThreadEntry): string {
  return entry.text.length > ENTRY_CUT
    ? `${entry.text.slice(0, ENTRY_CUT)}… (${entry.text.length - ENTRY_CUT} more chars)`
    : entry.text;
}

function asksDetail(ask: ThreadAsk): string {
  const parts = [oneLine(ask.prompt)];
  if (ask.choices.length > 0) {
    parts.push(`[choices: ${ask.choices.map((choice) => oneLine(choice.label)).join(", ")}]`);
  }
  if (ask.text) parts.push("[free text]");
  return `asks: ${parts.join(" ")}`;
}

/** The threads_list result for one id: the header row, its newest entries oldest first, and the open ask. */
export function detailText(thread: Thread): string {
  const lines = [row(thread)];
  for (const entry of thread.entries.slice(-LIST_LIMIT)) {
    lines.push(`${entry.role} ${localTime(entry.at)}: ${entryText(entry)}`);
  }
  if (thread.ask) lines.push(asksDetail(thread.ask));
  return lines.join("\n");
}

/** `…<up to 80 chars before>[match]<up to 80 chars after>…` around the first match in the text. */
function snippet(text: string, at: number, length: number): string {
  const raw =
    text.slice(Math.max(0, at - SNIPPET_SIDE), at) +
    `[${text.slice(at, at + length)}]` +
    text.slice(at + length, at + length + SNIPPET_SIDE);
  return `…${oneLine(raw)}…`;
}

function firstMatch(thread: Thread, query: string): string {
  if (thread.title.toLowerCase().includes(query)) return "match: title";
  if (thread.label?.toLowerCase().includes(query)) return "match: label";
  for (const entry of thread.entries) {
    const at = entry.text.toLowerCase().indexOf(query);
    if (at >= 0) return `match: ${snippet(entry.text, at, query.length)}`;
  }
  return "match: title";
}

/** The threads_search result: matching Threads newest first with their first match shown. */
export function searchText(threads: Thread[], query: string): string {
  const needle = query.toLowerCase();
  const matched = threads
    .filter(
      (thread) =>
        thread.title.toLowerCase().includes(needle) ||
        thread.label?.toLowerCase().includes(needle) ||
        thread.entries.some((entry) => entry.text.toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, SEARCH_LIMIT);
  if (matched.length === 0) return `no threads match "${query}"`;
  return matched.map((thread) => `${row(thread)}\n${firstMatch(thread, needle)}`).join("\n");
}
