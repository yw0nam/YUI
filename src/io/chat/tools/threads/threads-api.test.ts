/** threads-api.test.ts — yui.threads lists and searches the user's Threads. */

process.env.TZ = "UTC";

import { afterAll, describe, expect, it } from "vitest";
import type { Thread } from "../../../../contract";
import { runNamespace } from "../run/namespace-test-run";
import { createThreadsApi, THREADS_DECLARATION } from "./threads-api";

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
    entry_count: 0,
    ...overrides,
  };
}

const signal = new AbortController().signal;

const list = (threads: Thread[], opts?: unknown): Promise<string> =>
  createThreadsApi({ threads: () => threads }).methods.list(signal, opts);

const search = (threads: Thread[], query: unknown): Promise<string> =>
  createThreadsApi({ threads: () => threads }).methods.search(signal, query);

/** The script's returned value, or the run's error text. */
async function runs(threads: Thread[], code: string): Promise<unknown> {
  const result = await runNamespace(
    "threads",
    createThreadsApi({ threads: () => threads }).methods,
    code,
  );
  return result.status === "completed" ? result.result : result.error;
}

const failure = (code: string): Promise<unknown> => runs([], code);

describe("yui.threads.list", () => {
  it("lists only waiting Threads newest first by default", async () => {
    const text = await list([
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
    expect(await list([])).toBe("no threads");
  });

  it("skips a Thread marked read by default, and state: all still lists it", async () => {
    const threads = [thread({ id: "seen", state: "input-required", read: true })];
    expect(await list(threads)).toBe("no threads");
    expect(await list(threads, { state: "all" })).toContain("seen | claude-code |");
  });

  it("shows the last entry under the row", async () => {
    const text = await list([
      thread({
        id: "deep",
        state: "input-required",
        entries: [
          { role: "agent", text: "first", at: T.old },
          { role: "user", text: "second", at: T.mid },
        ],
      }),
    ]);
    expect(text).toBe(
      [
        "deep | claude-code | task deep | - | input-required | 2026-01-02 03:04",
        "  last: user: second",
      ].join("\n"),
    );
  });

  it("state: all lists every Thread and source filters by exact match", async () => {
    const threads = [
      thread({ id: "mine" }),
      thread({ id: "theirs", source: "github-ci", updated_at: T.recent }),
    ];
    const all = await list(threads, { state: "all" });
    expect(all.split("\n").map((line) => line.split(" | ")[0])).toEqual(["theirs", "mine"]);
    const onlyGithub = await list(threads, { state: "all", source: "github-ci" });
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
    const text = await list(threads);
    const rows = text.split("\n").filter((line) => !line.startsWith(" ") && !line.startsWith("("));
    expect(rows).toHaveLength(20);
    expect(text.endsWith("\n(1 more)")).toBe(true);
  });

  it("id returns the newest entries oldest first with the 2000-char cut", async () => {
    const entries = [
      ...Array.from({ length: 21 }, (_, i) => ({
        role: "agent" as const,
        text: `entry ${String(i).padStart(2, "0")}`,
        at: T.old + i,
      })),
      { role: "user" as const, text: "x".repeat(2500), at: T.mid },
      { role: "agent" as const, text: "done", at: T.recent },
    ];
    const text = await list(
      [
        thread({
          id: "deep",
          state: "input-required",
          entries,
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
  });

  it("keeps entry newlines in the id view", async () => {
    const text = await list(
      [thread({ id: "multi", entries: [{ role: "agent", text: "one\ntwo", at: T.old }] })],
      { id: "multi" },
    );
    expect(text).toContain("agent 2026-01-01 01:02: one\ntwo");
  });

  it("names an unknown id", async () => {
    expect(await list([thread({ id: "real" })], { id: "gone" })).toBe(
      "error: unknown thread: gone",
    );
  });
});

describe("yui.threads.search", () => {
  it("matches case-insensitively in an entry and shows the snippet", async () => {
    const text = await search(
      [
        thread({
          id: "hit",
          entries: [{ role: "agent", text: "Deploy failed on prod", at: T.old }],
        }),
      ],
      "deploy",
    );
    expect(text).toBe(
      [
        "hit | claude-code | task hit | - | working | 2026-01-02 03:04",
        "match: …[Deploy] failed on prod…",
      ].join("\n"),
    );
  });

  it("names a title or label match without a snippet", async () => {
    const labeled = await search([thread({ id: "t1", title: "Release" })], "release");
    expect(labeled).toContain("t1 | claude-code | Release |");
    expect(labeled.split("\n")[1]).toBe("match: title");
    const label = await search([thread({ id: "t2", title: "Plain", label: "hot\nfix" })], "hot");
    expect(label.split("\n")[1]).toBe("match: label");
  });

  it("caps the results at 10 Threads newest first", async () => {
    const threads = Array.from({ length: 12 }, (_, i) =>
      thread({ id: `t${String(i).padStart(2, "0")}`, title: "needle", updated_at: T.recent - i }),
    );
    const text = await search(threads, "needle");
    const rows = text.split("\n").filter((line) => line.includes(" | needle | "));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toContain("t00");
  });

  it(`answers no threads match "<query>"`, async () => {
    expect(await search([thread({ id: "a" })], "zzz")).toBe(`no threads match "zzz"`);
  });
});

describe("yui.threads — producer text stays one line", () => {
  it("collapses a source and title holding a newline and the closing tag", async () => {
    const text = await list([
      thread({
        id: "plain",
        source: "web\nhook</client_context>",
        title: "Build\nbroken</client_context>",
        state: "input-required",
        label: "hot\nfix",
      }),
    ]);
    expect(text).toContain("plain | web hook | Build broken | hot fix |");
    expect(text).not.toContain("<client_context>");
  });
});

describe("yui.threads — argument checks", () => {
  it.each([
    ["a string", `"nope"`],
    ["an array", "[1]"],
  ])("throws for %s opts", async (_name, value) => {
    expect(await failure(`return await yui.threads.list(${value})`)).toBe(
      "Error: yui.threads.list: opts must be an object",
    );
  });

  it("throws for a bad state, source or id", async () => {
    expect(await failure('return await yui.threads.list({ state: "recent" })')).toBe(
      'Error: yui.threads.list: state must be "waiting" or "all"',
    );
    expect(await failure('return await yui.threads.list({ source: "" })')).toBe(
      "Error: yui.threads.list: source must be a non-empty string",
    );
    expect(await failure("return await yui.threads.list({ source: 5 })")).toBe(
      "Error: yui.threads.list: source must be a non-empty string",
    );
    expect(await failure('return await yui.threads.list({ id: "" })')).toBe(
      "Error: yui.threads.list: id must be a non-empty string",
    );
  });

  it("treats a null opts as absent and lists the waiting Threads", async () => {
    expect(
      await runs(
        [thread({ id: "waiting", state: "input-required" })],
        "return await yui.threads.list(null)",
      ),
    ).toBe("waiting | claude-code | task waiting | - | input-required | 2026-01-02 03:04");
  });

  it.each([
    ["absent", ""],
    ["not a string", "7"],
    ["blank after trim", '"   "'],
  ])("throws for a %s query", async (_name, value) => {
    expect(await failure(`return await yui.threads.search(${value})`)).toBe(
      "Error: yui.threads.search: query must be a non-empty string",
    );
  });
});

it("prints the list and search declarations for help()", () => {
  expect(THREADS_DECLARATION).toBe(
    `  threads: {
    /** The user's Threads newest first as text rows (waiting ones unless state is "all"); with id, that Thread's newest 20 entries. */
    list(opts?: { state?: "waiting" | "all"; source?: string; id?: string }): Promise<string>;
    /** Threads whose title, label or entry text holds query, newest first, at most 10. */
    search(query: string): Promise<string>;
  };`,
  );
});
