// @vitest-environment jsdom
/** thread-list.test.tsx — a row's lines, and how a snapshot leaves the clicks and the focus in the list alone. */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../contract";
import { setLocale } from "../../i18n";
import { ThreadList } from "./thread-list";
import { threadListView } from "./thread-list-view";
import { threadsTabFocus } from "./threads-tab-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function thread(id: string, source: string, state: Thread["state"], updated_at: number): Thread {
  return { id, source, title: id, state, entries: [], created_at: 1, updated_at, entry_count: 0 };
}

const THREADS = [
  thread("d1", "claude-code", "working", 9),
  thread("w2", "slack", "input-required", 7),
  thread("w1", "codex", "input-required", 5),
  thread("d2", "codex", "completed", 3),
];

const filter = { tab: "all", kind: null } as const;

afterEach(() => {
  act(() => cleanup());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ThreadList", () => {
  it("draws a row as the source, state and time on one line, then the title, then the label", () => {
    setLocale("en");
    const th = { ...thread("w1", "codex", "input-required", 5), label: "mbp · memory-base (main)" };
    const { container } = render(
      <ThreadList
        view={threadListView([th], filter)}
        filter={filter}
        selected={null}
        now={5}
        onSelect={() => {}}
        onFilter={() => {}}
      />,
    );

    const row = container.querySelector(".yui-threads-row")!;
    expect([...row.children].map((el) => [el.tagName, el.textContent])).toEqual([
      ["SPAN", "CCodexNeeds replyjust now"],
      ["STRONG", "w1"],
      ["SPAN", "mbp · memory-base (main)"],
    ]);
  });
});

describe("a snapshot leaves the interaction alone", () => {
  function setup() {
    const onSelect = vi.fn();
    const list = (threads: Thread[], selected: string | null) => (
      <ThreadList
        view={threadListView(threads, filter)}
        filter={filter}
        selected={selected}
        now={10}
        onSelect={onSelect}
        onFilter={() => {}}
      />
    );
    const { container, rerender } = render(list(THREADS, "w2"));
    const draw = (threads = THREADS, selected: string | null = "w2") =>
      act(() => rerender(list(threads, selected)));
    const row = (id: string) => container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const rows = container.querySelector<HTMLElement>(".yui-threads-list__rows")!;
    // The Threads tab's own focus move, as the layout calls it.
    const focusSelected = () => act(() => threadsTabFocus({ current: container }).list());
    return { draw, onSelect, row, rows, focusSelected };
  }

  it("delivers a click whose press and release straddle a snapshot", () => {
    const { draw, onSelect, row } = setup();
    const pressed = row("w1").querySelector("strong")!;

    draw();
    fireEvent.click(pressed);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("w1");
  });

  it("keeps focus on an unselected row", () => {
    const { draw, row } = setup();
    const focused = row("w1");
    act(() => focused.focus());

    draw();

    expect(document.activeElement).toBe(focused);
  });

  it("does not refocus on a snapshot, and focusSelected does not scroll", () => {
    const { draw, row, focusSelected } = setup();
    act(() => row("w1").focus());
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    draw();
    expect(focus).not.toHaveBeenCalled();

    focusSelected();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("moves focus to the row at the same place when the selected Thread is filtered out", () => {
    const { draw, focusSelected } = setup();
    focusSelected();

    draw(
      THREADS.filter((th) => th.id !== "w2"),
      "w2",
    );

    expect((document.activeElement as HTMLElement).dataset.id).toBe("w1");
  });

  it("moves focus to the list when the last Thread leaves", () => {
    const { draw, rows, focusSelected } = setup();
    draw([THREADS[1]!]);
    focusSelected();

    draw([]);

    expect(document.activeElement).toBe(rows);
  });
});
