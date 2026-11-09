/** held-reactions.test.ts — one held reaction per Thread, the newest transition kept, dropped once the Thread moved on. */

import { expect, it } from "vitest";
import type { Thread } from "../../contract";
import { createHeldReactions } from "./held-reactions";

const snap = (...threads: Array<[string, Thread["state"]]>) => ({
  revision: 1,
  threads: threads.map(
    ([id, state]): Thread => ({
      id,
      source: "codex",
      title: "Build",
      state,
      entries: [],
      created_at: 1,
      updated_at: 1,
      entry_count: 0,
    }),
  ),
});

it("gives held reactions back oldest first, then null", () => {
  const held = createHeldReactions();
  held.hold({ id: "t1", state: "completed" });
  held.hold({ id: "t2", state: "failed" });
  expect([held.take(), held.take(), held.take()]).toEqual([
    { id: "t1", state: "completed" },
    { id: "t2", state: "failed" },
    null,
  ]);
});

it("keeps only the newest transition of a Thread", () => {
  const held = createHeldReactions();
  held.hold({ id: "t1", state: "input-required" });
  held.hold({ id: "t1", state: "completed" });
  expect([held.take(), held.take()]).toEqual([{ id: "t1", state: "completed" }, null]);
});

it("drops a reaction whose Thread changed state or is gone", () => {
  const held = createHeldReactions();
  held.hold({ id: "t1", state: "input-required" });
  held.hold({ id: "t2", state: "failed" });
  held.hold({ id: "t3", state: "completed" });
  held.prune(snap(["t1", "working"], ["t3", "completed"]));
  expect([held.take(), held.take()]).toEqual([{ id: "t3", state: "completed" }, null]);
});
