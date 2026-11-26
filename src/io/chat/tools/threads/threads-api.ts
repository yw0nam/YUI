/** yui.threads: the user's Threads, read as text rows in main's window. */

import type { Thread } from "../../../../contract";
import type { ThreadsClient } from "../../../threads/threads-client";
import { isWaiting } from "../../../threads/threads-waiting";
import { detailText, listText, searchText } from "./thread-text";

export type ThreadsApi = {
  methods: {
    list(signal: AbortSignal, opts?: unknown): Promise<string>;
    search(signal: AbortSignal, query: unknown): Promise<string>;
  };
  declaration: string;
};

export const THREADS_DECLARATION = `  threads: {
    /** The user's Threads newest first as text rows (waiting ones unless state is "all"); with id, that Thread's newest 20 entries. */
    list(opts?: { state?: "waiting" | "all"; source?: string; id?: string }): Promise<string>;
    /** Threads whose title, label or entry text holds query, newest first, at most 10. */
    search(query: string): Promise<string>;
  };`;

/** The list options; null and undefined count as no options. */
function optionsOf(opts: unknown): Record<string, unknown> {
  if (opts === undefined || opts === null) return {};
  if (typeof opts !== "object" || Array.isArray(opts))
    throw new TypeError("yui.threads.list: opts must be an object");
  return opts as Record<string, unknown>;
}

/** An option as a non-empty string; null counts as absent. */
function stringOption(method: string, name: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`yui.threads.${method}: ${name} must be a non-empty string`);
  return value;
}

export function createThreadsApi(client: Pick<ThreadsClient, "threads">): ThreadsApi {
  const threads = (): Thread[] => client.threads();

  const list = async (_signal: AbortSignal, opts?: unknown): Promise<string> => {
    const options = optionsOf(opts);
    const state = options.state ?? undefined;
    if (state !== undefined && state !== "waiting" && state !== "all")
      throw new TypeError('yui.threads.list: state must be "waiting" or "all"');
    const source = stringOption("list", "source", options.source);
    const id = stringOption("list", "id", options.id);
    const all = threads();
    if (id !== undefined) {
      const thread = all.find((candidate) => candidate.id === id);
      return thread ? detailText(thread) : `error: unknown thread: ${id}`;
    }
    const filtered = all.filter(
      (thread) =>
        (state === "all" || isWaiting(thread)) &&
        (source === undefined || thread.source === source),
    );
    filtered.sort((a, b) => b.updated_at - a.updated_at);
    return listText(filtered);
  };

  const search = async (_signal: AbortSignal, query: unknown): Promise<string> => {
    if (typeof query !== "string" || query.trim() === "")
      throw new TypeError("yui.threads.search: query must be a non-empty string");
    return searchText(threads(), query.trim());
  };

  return { methods: { list, search }, declaration: THREADS_DECLARATION };
}
