/** yui.threads: the user's Threads, read as text rows. */

import type { ThreadsClient } from "../../../threads/threads-client";

export type ThreadsApi = {
  methods: {
    list(signal: AbortSignal, opts?: unknown): Promise<string>;
    search(signal: AbortSignal, query: unknown): Promise<string>;
  };
  declaration: string;
};

export const THREADS_DECLARATION = "";

export function createThreadsApi(_client: Pick<ThreadsClient, "threads">): ThreadsApi {
  return {
    methods: {
      list: async () => "",
      search: async () => "",
    },
    declaration: THREADS_DECLARATION,
  };
}
