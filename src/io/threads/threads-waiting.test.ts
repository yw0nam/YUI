/** threads-waiting.test.ts — the waiting-Threads count behind the threads: client-context line. */

import { describe, expect, it } from "vitest";
import type { Thread } from "../../contract";
import { threadsWaiting } from "./threads-waiting";

function thread(source: string, state: Thread["state"]): Thread {
  return {
    id: source,
    source,
    title: source,
    state,
    entries: [],
    created_at: 0,
    updated_at: 0,
  };
}

describe("threadsWaiting", () => {
  it("counts input-required Threads per source, count desc then source name", () => {
    const threads = [
      thread("claude-code", "input-required"),
      thread("claude-code", "input-required"),
      thread("api", "input-required"),
      thread("api", "input-required"),
      thread("github-ci", "input-required"),
      thread("api", "working"),
      thread("zed", "completed"),
      thread("zed", "failed"),
    ];
    expect(threadsWaiting(threads)).toEqual({
      total: 5,
      by_source: [
        { source: "api", count: 2 },
        { source: "claude-code", count: 2 },
        { source: "github-ci", count: 1 },
      ],
    });
  });

  it("reports zero with no waiting Threads", () => {
    expect(threadsWaiting([])).toEqual({ total: 0, by_source: [] });
    expect(threadsWaiting([thread("ci", "working")])).toEqual({ total: 0, by_source: [] });
  });
});
