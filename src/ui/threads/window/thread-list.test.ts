/** thread-list.test.ts — the list's order, its Waiting / All tabs and kind filter with counts, and the Thread a fresh open shows. */

import { describe, expect, it } from "vitest";
import type { Thread } from "../../../contract";
import { openSelection, threadListView } from "./thread-list";

function thread(id: string, source: string, state: Thread["state"], updated_at: number): Thread {
  return { id, source, title: id, state, entries: [], created_at: 1, updated_at };
}

const THREADS = [
  thread("d1", "claude-code", "working", 9),
  thread("w2", "slack", "input-required", 7),
  thread("w1", "codex", "input-required", 5),
  thread("d2", "codex", "completed", 3),
];

describe("threadListView", () => {
  it.each([
    [
      "All lists waiting Threads first, then newest",
      { tab: "all", kind: null },
      ["w2", "w1", "d1", "d2"],
      [
        { source: "claude-code", count: 1, disabled: false },
        { source: "codex", count: 2, disabled: false },
        { source: "slack", count: 1, disabled: false },
      ],
    ],
    [
      "Waiting keeps every source as a kind and disables the ones with none waiting",
      { tab: "waiting", kind: null },
      ["w2", "w1"],
      [
        { source: "claude-code", count: 0, disabled: true },
        { source: "codex", count: 1, disabled: false },
        { source: "slack", count: 1, disabled: false },
      ],
    ],
    [
      "a kind narrows the tab and stays selectable at zero",
      { tab: "waiting", kind: "claude-code" },
      [],
      [
        { source: "claude-code", count: 0, disabled: false },
        { source: "codex", count: 1, disabled: false },
        { source: "slack", count: 1, disabled: false },
      ],
    ],
  ] as const)("%s", (_name, filter, ids, kinds) => {
    const view = threadListView(THREADS, filter);

    expect(view.rows.map((t) => t.id)).toEqual(ids);
    expect(view.kinds).toEqual(kinds);
    expect(view.counts).toEqual({ waiting: 2, all: 4 });
  });

  it("falls back to all kinds when the selected kind left the snapshot", () => {
    const view = threadListView(THREADS, { tab: "all", kind: "gmail" });

    expect(view.kind).toBe(null);
    expect(view.rows.map((t) => t.id)).toEqual(["w2", "w1", "d1", "d2"]);
  });
});

describe("openSelection", () => {
  it.each([
    ["the newest waiting Thread", THREADS, "w2"],
    ["the newest Thread when none waits", [THREADS[0]!, THREADS[3]!], "d1"],
    ["nothing when there are no Threads", [], null],
  ])("opens on %s", (_name, threads, id) => {
    expect(openSelection(threads)).toBe(id);
  });
});
