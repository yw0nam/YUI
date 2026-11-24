// @vitest-environment jsdom
/** thread-rail.test.tsx — focusing the selected Thread in the rail does not scroll the rail. */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Thread } from "../../../contract";
import { focusCurrentRow } from "./row-focus";
import { threadListView } from "./thread-list-view";
import { ThreadRail } from "./thread-rail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => cleanup());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("focusSelected focuses the selected row without scrolling", () => {
  const th: Thread = {
    id: "w1",
    source: "codex",
    title: "w1",
    state: "input-required",
    entries: [],
    created_at: 1,
    updated_at: 5,
    entry_count: 0,
  };
  const filter = { tab: "all", kind: null } as const;
  const { container } = render(
    <ThreadRail
      view={threadListView([th], filter)}
      filter={filter}
      selected="w1"
      onSelect={() => {}}
      onFilter={() => {}}
    />,
  );
  const focus = vi.spyOn(HTMLElement.prototype, "focus");

  focusCurrentRow(container.querySelector(".yui-threads-rail__list"));

  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
