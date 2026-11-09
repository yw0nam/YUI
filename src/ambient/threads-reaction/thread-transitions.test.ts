/** thread-transitions.test.ts — which Thread state changes a Thread reaction answers. */

import { expect, it } from "vitest";
import type { Thread } from "../../contract";
import { createThreadTransitions } from "./thread-transitions";

const thread = (id: string, state: Thread["state"]): Thread => ({
  id,
  source: "codex",
  title: "Build",
  state,
  entries: [],
  created_at: 1,
  updated_at: 1,
  entry_count: 0,
});
const snap = (...threads: Thread[]) => ({ revision: 1, threads });

it("takes the first snapshot as the baseline", () => {
  const transitions = createThreadTransitions();
  expect(transitions.next(snap(thread("t1", "input-required")))).toEqual([]);
});

it.each([
  "input-required",
  "completed",
  "failed",
] as const)("reports a Thread that became %s, once", (state) => {
  const transitions = createThreadTransitions();
  transitions.next(snap(thread("t1", "working")));
  expect(transitions.next(snap(thread("t1", state)))).toEqual([{ id: "t1", state }]);
  expect(transitions.next(snap(thread("t1", state)))).toEqual([]);
});

it("ignores a Thread that went back to working", () => {
  const transitions = createThreadTransitions();
  transitions.next(snap(thread("t1", "input-required")));
  expect(transitions.next(snap(thread("t1", "working")))).toEqual([]);
});

it("reports a new Thread that arrives in a reacting state, and not one that arrives working", () => {
  const transitions = createThreadTransitions();
  transitions.next(snap());
  expect(transitions.next(snap(thread("t2", "failed"), thread("t3", "working")))).toEqual([
    { id: "t2", state: "failed" },
  ]);
});
