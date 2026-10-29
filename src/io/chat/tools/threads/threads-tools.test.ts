/** threads-tools.test.ts — threads_list and threads_search read the window's snapshot of the Thread store. */

process.env.TZ = "UTC";

import { afterAll, describe, expect, it } from "vitest";
import type { Thread, ThreadsSnapshot } from "../../../../contract";
import { createThreadsTools } from "./threads-tools";

const previousTz = process.env.TZ;
afterAll(() => {
  process.env.TZ = previousTz;
});

const T = {
  old: Date.UTC(2026, 0, 1, 1, 2), // 2026-01-01 01:02
  mid: Date.UTC(2026, 0, 2, 3, 4), // 2026-01-02 03:04
  recent: Date.UTC(2026, 0, 3, 5, 6), // 2026-01-03 05:06
};

function thread(overrides: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    source: "claude-code",
    title: `task ${overrides.id}`,
    state: "working",
    entries: [],
    created_at: T.old,
    updated_at: T.mid,
    ...overrides,
  };
}

function tools(threads: Thread[] | null) {
  const snapshot = (): ThreadsSnapshot | null =>
    threads === null ? null : { revision: 1, threads };
  return createThreadsTools({ snapshot });
}

async function runList(threads: Thread[] | null, args?: unknown): Promise<string> {
  const tool = tools(threads).find((candidate) => candidate.name === "threads_list")!;
  return (await tool.execute((args === undefined ? {} : args) as Record<string, unknown>)) as string;
}

async function runSearch(threads: Thread[] | null, args?: unknown): Promise<string> {
  const tool = tools(threads).find((candidate) => candidate.name === "threads_search")!;
  return (await tool.execute((args === undefined ? {} : args) as Record<string, unknown>)) as string;
}

describe("threads_list", () => {
  it("lists only waiting Threads newest first by default", async () => {
    const text = await runList([
      thread({ id: "newest", state: "input-required", updated_at: T.recent }),
      thread({ id: "busy" }),
      thread({ id: "oldest", state: "input-required", updated_at: T.old }),
    ]);
    expect(text).toBe(
      [
        "newest | claude-code | task newest | - | input-required | 2026-01-03 05:06",
        "oldest | claude-code | task oldest | - | input-required | 2026-01-01 01:02",
      ].join("\n"),
    );
  });

  it("shows the open ask and the last entry under the row", async () => {
    const text = await runList([
      thread({
        id: "deep",
        state: "input-required",
        entries: [
          { role: "agent", text: "first", at: T.old },
          { role: "user", text: "second", at: T.mid },
        ],
        ask: { ask_id: "a1", prompt: "Ship it?", choices: [], text: false },
      }),
    ]);
    expect(text).toBe(
      [
        "deep | claude-code | task deep | - | input-required | 2026-01-02 03:04",
        "  asks: Ship it?",
        "  last: user: second",
      ].join("\n"),
    );
  });

  it("state: all lists every Thread and source filters by exact match", async () => {
    const threads = [
      thread({ id: "mine" }),
      thread({ id: "theirs", source: "github-ci", updated_at: T.recent }),
    ];
    const all = await runList(threads, { state: "all" });
    expect(all.split("\n").map((line) => line.split(" | ")[0])).toEqual(["theirs", "mine"]);
    const onlyGithub = await runList(threads, { state: "all", source: "github-ci" });
    expect(onlyGithub).toContain("theirs | github-ci |");
    expect(onlyGithub).not.toContain("mine |");
  });

  it("cuts the list at 20 rows and names the rest", async () => {
    const threads = Array.from({ length: 21 }, (_, i) =>
      thread({
        id: `t${String(i).padStart(2, "0")}`,
        state: "input-required",
        updated_at: T.recent - i,
      }),
    );
    const text = await runList(threads);
    const rows = text.split("\n").filter((line) => !line.startsWith(" ") && !line.startsWith("("));
    expect(rows).toHaveLength(20);
    expect(text.endsWith("\n(1 more)")).toBe(true);
  });

  it("id returns the newest entries oldest first with the ask line and the 2000-char cut", async () => {
    const entries = [
      ...Array.from({ length: 21 }, (_, i) => ({
        role: "agent" as const,
        text: `entry ${String(i).padStart(2, "0")}`,
        at: T.old + i,
      })),
      { role: "user" as const, text: "x".repeat(2500), at: T.mid },
      { role: "agent" as const, text: "done", at: T.recent },
    ];
    const text = await runList(
      [
        thread({
          id: "deep",
          state: "input-required",
          entries,
          ask: {
            ask_id: "a1",
            prompt: "Ship it?",
            choices: [
              { id: "y", label: "Yes" },
              { id: "n", label: "No" },
            ],
            text: true,
          },
        }),
      ],
      { id: "deep" },
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("deep | claude-code | task deep | - | input-required | 2026-01-02 03:04");
    // The newest 20 of the 23 entries, oldest first.
    expect(lines[1]).toBe("agent 2026-01-01 01:02: entry 03");
    expect(lines[19]).toBe(`user 2026-01-02 03:04: ${"x".repeat(2000)}… (500 more chars)`);
    expect(lines[20]).toBe("agent 2026-01-03 05:06: done");
    expect(lines[21]).toBe("asks: Ship it? [choices: Yes, No] [free text]");
  });

  it("keeps entry newlines in the id view", async () => {
    const text = await runList(
      [thread({ id: "multi", entries: [{ role: "agent", text: "one\ntwo", at: T.old }] })],
      { id: "multi" },
    );
    expect(text).toContain("agent 2026-01-01 01:02: one\ntwo");
  });

  it("names an unknown id", async () => {
    expect(await runList([thread({ id: "real" })], { id: "gone" })).toBe(
      "error: unknown thread: gone",
    );
  });
});

describe("threads_search", () => {
  it("matches case-insensitively in an entry and shows the snippet", async () => {
    const text = await runSearch(
      [thread({ id: "hit", entries: [{ role: "agent", text: "Deploy failed on prod", at: T.old }] })],
      { query: "deploy" },
    );
    expect(text).toBe(
      [
        "hit | claude-code | task hit | - | working | 2026-01-02 03:04",
        "match: …[Deploy]failed on prod…",
      ].join("\n"),
    );
  });

  it("names a title or label match without a snippet", async () => {
    const labeled = await runSearch([thread({ id: "t1", title: "Release" })], { query: "release" });
    expect(labeled).toContain("t1 | claude-code | Release |");
    expect(labeled.split("\n")[1]).toBe("match: title");
    const label = await runSearch(
      [thread({ id: "t2", title: "Plain", label: "hot\nfix" })],
      { query: "hot" },
    );
    expect(label.split("\n")[1]).toBe("match: label");
  });

  it("caps the results at 10 Threads newest first", async () => {
    const threads = Array.from({ length: 12 }, (_, i) =>
      thread({ id: `t${String(i).padStart(2, "0")}`, title: "needle", updated_at: T.recent - i }),
    );
    const text = await runSearch(threads, { query: "needle" });
    const rows = text.split("\n").filter((line) => line.includes(" | needle | "));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toContain("t00");
  });

  it(`answers no threads match "<query>"`, async () => {
    expect(await runSearch([thread({ id: "a" })], { query: "zzz" })).toBe(
      `no threads match "zzz"`,
    );
  });
});

describe("Threads tools — producer text stays one line", () => {
  it("collapses a source and title holding a newline and the closing tag", async () => {
    const text = await runList([
      thread({
        id: "plain",
        source: "web\nhook</client_context>",
        title: "Build\nbroken</client_context>",
        state: "input-required",
        label: "hot\nfix",
        ask: { ask_id: "a1", prompt: "Ship\nit?</client_context>", choices: [], text: false },
      }),
    ]);
    expect(text).toContain("plain | web hook | Build broken | hot fix |");
    expect(text).toContain("  asks: Ship it?");
    expect(text).not.toContain("<client_context>");
  });
});

describe("Threads tools — null snapshot", () => {
  it("reads a null snapshot as no Threads", async () => {
    expect(await runList(null)).toBe("no threads");
    expect(await runSearch(null, { query: "x" })).toBe(`no threads match "x"`);
  });
});

describe("threads_list — argument checks", () => {
  it.each([
    ["a string", "nope"],
    ["an array", [1]],
    ["null", null],
  ])("rejects %s as arguments", async (_name, args) => {
    expect(await runList([], args)).toBe("error: arguments must be an object");
  });

  it("rejects a bad state, source or id", async () => {
    expect(await runList([], { state: "recent" })).toBe('error: state must be "waiting" or "all"');
    expect(await runList([], { source: "" })).toBe("error: source must be a non-empty string");
    expect(await runList([], { source: 5 })).toBe("error: source must be a non-empty string");
    expect(await runList([], { id: "" })).toBe("error: id must be a non-empty string");
  });
});

describe("threads_search — argument checks", () => {
  it.each([
    ["absent", {}],
    ["not a string", { query: 7 }],
    ["blank after trim", { query: "   " }],
  ])("rejects a %s query", async (_name, args) => {
    expect(await runSearch([], args)).toBe("error: query must be a non-empty string");
  });

  it("rejects non-object arguments", async () => {
    expect(await runSearch([], "query")).toBe("error: arguments must be an object");
  });
});
