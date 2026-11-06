/** drafts.test.ts — what a new snapshot leaves of each unsent draft, keyed by the ask it answers. */

import { expect, it } from "vitest";
import type { Thread, ThreadAsk } from "../../../contract";
import { type Draft, draftKey, pruneDrafts } from "./drafts";

function thread(id: string, ask?: ThreadAsk): Thread {
  return {
    id,
    source: "codex",
    title: id,
    state: ask ? "input-required" : "working",
    entries: [],
    ...(ask ? { ask } : {}),
    created_at: 1,
    updated_at: 1,
    entry_count: 0,
  };
}

const ask = (ask_id: string, text: boolean, choices: string[] = []): ThreadAsk => ({
  ask_id,
  prompt: "?",
  choices: choices.map((id) => ({ id, label: id })),
  text,
});

it("drops drafts of closed or replaced asks, vanished choices, and text an ask no longer takes", () => {
  const drafts = new Map<string, Draft>([
    [draftKey("t1", "kept"), { picks: ["allow"], text: "x" }],
    [draftKey("t2", "choice-gone"), { picks: ["gone"], text: "y" }],
    [draftKey("t3", "text-off"), { picks: [], text: "z" }],
    [draftKey("t4", "replaced"), { picks: [], text: "old" }],
    [draftKey("t5", "closed"), { picks: [], text: "w" }],
    [draftKey("t6", "thread-gone"), { picks: [], text: "v" }],
    [draftKey("t2", "kept"), { picks: [], text: "same ask id, other Thread" }],
  ]);

  pruneDrafts(drafts, [
    thread("t1", ask("kept", true, ["allow"])),
    thread("t2", ask("choice-gone", true)),
    thread("t3", ask("text-off", false, ["ok"])),
    thread("t4", ask("new", true)),
    thread("t5"),
  ]);

  expect([...drafts]).toEqual([
    [draftKey("t1", "kept"), { picks: ["allow"], text: "x" }],
    [draftKey("t2", "choice-gone"), { picks: [], text: "y" }],
    [draftKey("t3", "text-off"), { picks: [], text: "" }],
  ]);
});

it.each([
  [true, ["b", "a"]],
  [false, ["b"]],
] as const)("prunes picks to the offered choices in multiple mode %s", (multiple, expected) => {
  const drafts = new Map<string, Draft>([["t\na", { picks: ["gone", "b", "a"], text: "why" }]]);
  pruneDrafts(drafts, [
    thread("t", {
      ...ask("a", true, ["a", "b"]),
      ...(multiple ? { multiple: true as const } : {}),
    }),
  ]);
  expect([...drafts]).toEqual([["t\na", { picks: expected, text: "why" }]]);
});
