// @vitest-environment jsdom
/** thread-rail.test.ts — focusing the selected Thread in the rail does not scroll the rail. */

import { afterEach, expect, it, vi } from "vitest";
import type { Thread } from "../../../contract";
import { threadListView } from "./thread-list";
import { createThreadRail } from "./thread-rail";

afterEach(() => {
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
  };
  const rail = createThreadRail({ onSelect() {}, onFilter() {} });
  document.body.append(rail.el);
  const filter = { tab: "all", kind: null } as const;
  rail.render(threadListView([th], filter), filter, "w1");
  const focus = vi.spyOn(HTMLElement.prototype, "focus");

  rail.focusSelected();

  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
