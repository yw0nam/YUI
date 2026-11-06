// @vitest-environment jsdom
/** thread-list.test.ts — the list's order, its Waiting / All tabs and kind filter with counts, a row's lines, and the Thread a fresh open shows. */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../contract";
import { setLocale } from "../../i18n";
import { createThreadList, openSelection, threadListView } from "./thread-list";

function thread(id: string, source: string, state: Thread["state"], updated_at: number): Thread {
  return { id, source, title: id, state, entries: [], created_at: 1, updated_at, entry_count: 0 };
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

describe("createThreadList", () => {
  it("draws a row as the source, state and time on one line, then the title, then the label", () => {
    setLocale("en");
    const list = createThreadList({ onSelect() {}, onFilter() {} });
    const th = { ...thread("w1", "codex", "input-required", 5), label: "mbp · memory-base (main)" };
    const filter = { tab: "all", kind: null } as const;
    list.render(threadListView([th], filter), filter, null, 5);

    const row = list.el.querySelector(".yui-threads-row")!;
    expect([...row.children].map((el) => [el.tagName, el.textContent])).toEqual([
      ["SPAN", "CCodexNeeds replyjust now"],
      ["STRONG", "w1"],
      ["SPAN", "mbp · memory-base (main)"],
    ]);
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

describe("a snapshot leaves the interaction alone", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  const filter = { tab: "all", kind: null } as const;
  function setup() {
    const onSelect = vi.fn();
    const list = createThreadList({ onSelect, onFilter() {} });
    document.body.append(list.el);
    const render = (threads = THREADS, selected: string | null = "w2") =>
      list.render(threadListView(threads, filter), filter, selected, 10);
    render();
    const row = (id: string) => list.el.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    return { list, render, onSelect, row };
  }

  it("delivers a click whose press and release straddle a snapshot", () => {
    const { render, onSelect, row } = setup();
    const pressed = row("w1").querySelector("strong")!;

    render();
    pressed.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("w1");
  });

  it("keeps focus on an unselected row", () => {
    const { render, row } = setup();
    const focused = row("w1");
    focused.focus();

    render();

    expect(document.activeElement).toBe(focused);
  });

  it("does not refocus on a snapshot, and focusSelected does not scroll", () => {
    const { list, render, row } = setup();
    row("w1").focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    render();
    expect(focus).not.toHaveBeenCalled();

    list.focusSelected();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("moves focus to the row at the same place when the selected Thread is filtered out", () => {
    const { list, render } = setup();
    list.focusSelected();

    render(
      THREADS.filter((th) => th.id !== "w2"),
      "w2",
    );

    expect((document.activeElement as HTMLElement).dataset.id).toBe("w1");
  });

  it("moves focus to the list when the last Thread leaves", () => {
    const { list, render } = setup();
    render([THREADS[1]!]);
    list.focusSelected();

    render([]);

    expect(document.activeElement).toBe(list.el.querySelector(".yui-threads-list__rows"));
  });
});
