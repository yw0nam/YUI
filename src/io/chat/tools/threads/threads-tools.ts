/** The Threads tools: threads_list and threads_search read the window's snapshot of the Thread store. */

import type { Thread } from "../../../../contract";
import type { ThreadsClient } from "../../../threads/threads-client";
import type { ClientTool } from "../client-tools";
import { detailText, listText, searchText } from "./thread-text";

/** The call's arguments, arriving as unchecked parsed JSON. */
function asObject(args: unknown): Record<string, unknown> | undefined {
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createThreadsTools(client: Pick<ThreadsClient, "snapshot">): ClientTool[] {
  const threads = (): Thread[] => client.snapshot()?.threads ?? [];

  const list: ClientTool = {
    name: "threads_list",
    definition: {
      type: "function" as const,
      function: {
        name: "threads_list",
        description:
          "List the user's Threads — outside conversations a producer posted. Each row names the id, source, title, label, state and last update, with the open ask and the last entry under it.",
        parameters: {
          type: "object" as const,
          properties: {
            state: {
              type: "string",
              enum: ["waiting", "all"],
              description:
                '"waiting" (default) lists only Threads that wait for the user\'s answer; "all" lists every Thread.',
            },
            source: {
              type: "string",
              description: "Exact producer name to keep, e.g. claude-code.",
            },
            id: {
              type: "string",
              description:
                "One Thread's id: returns that Thread's conversation (its newest 20 entries) instead of the list.",
            },
          },
          additionalProperties: false as const,
        },
      },
    },
    execute: async (args) => {
      const object = asObject(args);
      if (!object) return "error: arguments must be an object";
      const { state, source, id } = object;
      if (state !== undefined && state !== "waiting" && state !== "all")
        return 'error: state must be "waiting" or "all"';
      if (source !== undefined && nonEmptyString(source) === undefined)
        return "error: source must be a non-empty string";
      if (id !== undefined && nonEmptyString(id) === undefined)
        return "error: id must be a non-empty string";
      const all = threads();
      if (id !== undefined) {
        const thread = all.find((candidate) => candidate.id === id);
        return thread ? detailText(thread) : `error: unknown thread: ${id}`;
      }
      const filtered = all.filter(
        (thread) =>
          (state === "all" || thread.state === "input-required") &&
          (source === undefined || thread.source === source),
      );
      filtered.sort((a, b) => b.updated_at - a.updated_at);
      return listText(filtered);
    },
    waitMs: 2000,
  };

  const search: ClientTool = {
    name: "threads_search",
    definition: {
      type: "function" as const,
      function: {
        name: "threads_search",
        description:
          "Search the user's Threads by a case-insensitive substring over title, label and entry text.",
        parameters: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "The text to find." },
          },
          additionalProperties: false as const,
          required: ["query"],
        },
      },
    },
    execute: async (args) => {
      const object = asObject(args);
      if (!object) return "error: arguments must be an object";
      const query = object.query;
      if (typeof query !== "string" || query.trim() === "")
        return "error: query must be a non-empty string";
      return searchText(threads(), query.trim());
    },
    waitMs: 2000,
  };

  return [list, search];
}
