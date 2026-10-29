/** drafts.test.ts — what a new snapshot leaves of each unsent draft, keyed by the ask it answers. */

import { expect, it } from "vitest";
import type { Thread, ThreadAsk } from "../../../contract";
import { type Draft, pruneDrafts } from "./drafts";

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
    ["kept", { choice: "allow", text: "x" }],
    ["choice-gone", { choice: "gone", text: "y" }],
    ["text-off", { text: "z" }],
    ["replaced", { text: "old" }],
    ["closed", { text: "w" }],
    ["thread-gone", { text: "v" }],
  ]);

  pruneDrafts(drafts, [
    thread("t1", ask("kept", true, ["allow"])),
    thread("t2", ask("choice-gone", true)),
    thread("t3", ask("text-off", false, ["ok"])),
    thread("t4", ask("new", true)),
    thread("t5"),
  ]);

  expect([...drafts]).toEqual([
    ["kept", { choice: "allow", text: "x" }],
    ["choice-gone", { text: "y" }],
    ["text-off", { text: "" }],
  ]);
});
