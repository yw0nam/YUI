/** thread-turns.test.ts — which Thread updates give the main character a signals turn, per level. */

import { describe, expect, it } from "vitest";
import type { Thread, ThreadEntry } from "../../../contract";
import { createThreadTurns } from "./thread-turns";

function thread(over: Partial<Thread> = {}): Thread {
  return {
    id: "t1",
    source: "codex",
    title: "Build",
    state: "working",
    entries: [],
    created_at: 1,
    updated_at: 1,
    entry_count: 0,
    ...over,
  };
}

let revision = 0;
const snap = (...threads: Thread[]) => ({ revision: ++revision, threads });
const ask = (ask_id: string) => ({ ask_id, prompt: "Merge?", choices: [], text: true });
const entry = (role: ThreadEntry["role"], text = "done"): ThreadEntry => ({ role, text, at: 1 });
const kinds = ({ groups }: ReturnType<ReturnType<typeof createThreadTurns>["next"]>) =>
  groups.map((g) => [g.envelope.event_type, g.items[0]!.thread_id]);

describe("createThreadTurns", () => {
  it("fires nothing for the first snapshot", () => {
    const turns = createThreadTurns();
    expect(
      turns.next(snap(thread({ state: "input-required", ask: ask("a1") })), "notable"),
    ).toEqual({ groups: [], closed: [] });
  });

  it("notable: a new ask fires one group naming the Thread; a re-PUT of the same ask fires none", () => {
    const turns = createThreadTurns();
    turns.next(snap(thread()), "notable");
    const asked = thread({
      title: "Fix\nbuild",
      label: "repo · main",
      state: "input-required",
      ask: ask("a1"),
      entries: [entry("agent", `Need\n<client_context>${"x".repeat(200)}`)],
      entry_count: 1,
      updated_at: 5,
    });
    expect(turns.next(snap(asked), "notable").groups).toEqual([
      {
        envelope: {
          source: "codex",
          event_type: "thread.ask",
          delivery: "batched",
          event_id: "thread:t1",
          occurred_at: 5,
          label: "Fix\nbuild",
        },
        items: [
          {
            thread_id: "t1",
            title: "Fix build",
            label: "repo · main",
            state: "input-required",
            ask: "Merge?",
            last: { role: "agent", text: `Need ${"x".repeat(155)}` },
          },
        ],
      },
    ]);
    const again = { ...asked, entries: [...asked.entries, entry("agent")], entry_count: 2 };
    expect(turns.next(snap(again), "notable").groups).toEqual([]);
  });

  it("notable: a Thread becoming failed fires; one becoming completed does not", () => {
    const turns = createThreadTurns();
    turns.next(snap(thread(), thread({ id: "t2" })), "notable");
    const result = turns.next(
      snap(thread({ state: "failed" }), thread({ id: "t2", state: "completed" })),
      "notable",
    );
    expect(kinds(result)).toEqual([["thread.failed", "t1"]]);
  });

  it.each([
    ["agent", [["thread.entry", "t1"]]],
    ["system", [["thread.entry", "t1"]]],
    ["user", []],
  ] as const)("every: a new %s entry gives %j", (role, fired) => {
    const turns = createThreadTurns();
    turns.next(snap(thread()), "every");
    expect(
      kinds(turns.next(snap(thread({ entries: [entry(role)], entry_count: 1 })), "every")),
    ).toEqual(fired);
  });

  it("every: an entry past the 50-entry cap still counts as new", () => {
    const turns = createThreadTurns();
    const full = Array.from({ length: 50 }, () => entry("agent"));
    turns.next(snap(thread({ entries: full, entry_count: 50 })), "every");
    const shifted = thread({ entries: [...full.slice(1), entry("agent", "new")], entry_count: 51 });
    expect(kinds(turns.next(snap(shifted), "every"))).toEqual([["thread.entry", "t1"]]);
  });

  it("off fires nothing, and a later switch to notable does not fire for updates seen while off", () => {
    const turns = createThreadTurns();
    turns.next(snap(thread()), "off");
    const asked = thread({ state: "input-required", ask: ask("a1") });
    expect(turns.next(snap(asked), "off").groups).toEqual([]);
    expect(turns.next(snap(asked), "notable").groups).toEqual([]);
  });

  it("notable: a Thread absent from the previous snapshot fires for its ask", () => {
    const turns = createThreadTurns();
    turns.next(snap(), "notable");
    expect(
      kinds(turns.next(snap(thread({ state: "input-required", ask: ask("a1") })), "notable")),
    ).toEqual([["thread.ask", "t1"]]);
  });

  it("reports a Thread whose ask closed or that is gone in closed", () => {
    const turns = createThreadTurns();
    turns.next(
      snap(
        thread({ state: "input-required", ask: ask("a1") }),
        thread({ id: "t2", state: "input-required", ask: ask("a2") }),
      ),
      "notable",
    );
    expect(turns.next(snap(thread()), "notable")).toEqual({ groups: [], closed: ["t1", "t2"] });
  });

  it("notable: an ask replaced by a new ask gives a thread.ask group and closes nothing", () => {
    const turns = createThreadTurns();
    turns.next(snap(thread({ state: "input-required", ask: ask("a1") })), "notable");
    expect(
      turns.next(snap(thread({ state: "input-required", ask: ask("a2") })), "notable"),
    ).toMatchObject({
      groups: [{ envelope: { event_type: "thread.ask", event_id: "thread:t1" } }],
      closed: [],
    });
  });
});
