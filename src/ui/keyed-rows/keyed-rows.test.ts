// @vitest-environment jsdom
/** keyed-rows.test.ts — a list snapshot keeps each row's node, moves only what changed, and leaves focus where it was or hands it to a neighbour. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { keepFocus, reconcileRows } from "./keyed-rows";

const rows = {
  key: (s: string) => s,
  create(s: string) {
    const row = document.createElement("button");
    row.textContent = s;
    return row;
  },
};

function setup(items: string[]) {
  const container = document.createElement("div");
  document.body.append(container);
  reconcileRows(container, items, rows);
  const node = (s: string) => [...container.children].find((c) => c.textContent === s)!;
  return { container, node };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("reconcileRows", () => {
  it("keeps every node, updates it, and moves nothing when the order is unchanged", () => {
    const { container, node } = setup(["a", "b", "c"]);
    const before = ["a", "b", "c"].map(node);
    const insert = vi.spyOn(container, "insertBefore");
    const update = vi.fn();

    reconcileRows(container, ["a", "b", "c"], { ...rows, update });

    expect([...container.children]).toEqual(before);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("moves only the row that changed position", () => {
    const { container, node } = setup(["a", "b", "c"]);
    const before = ["a", "b", "c"].map(node);
    const insert = vi.spyOn(container, "insertBefore");

    reconcileRows(container, ["c", "a", "b"], rows);

    expect([...container.children]).toEqual([before[2], before[0], before[1]]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("removes a gone row without moving the survivors, so a focused one keeps focus", () => {
    const { container, node } = setup(["a", "b", "c"]);
    const b = node("b") as HTMLElement;
    b.focus();
    const insert = vi.spyOn(container, "insertBefore");

    reconcileRows(container, ["b", "c"], rows);

    expect(insert).not.toHaveBeenCalled();
    expect(container.children).toHaveLength(2);
    expect(document.activeElement).toBe(b);
  });

  it("creates a row for a new key and drops a stray child", () => {
    const { container, node } = setup(["a"]);
    container.append(document.createElement("p"));
    const a = node("a");

    reconcileRows(container, ["a", "b"], rows);

    expect([...container.children].map((c) => c.textContent)).toEqual(["a", "b"]);
    expect(container.firstChild).toBe(a);
  });
});

describe("keepFocus", () => {
  it.each([
    ["the row now at its index", ["a", "b", "c"], "b", ["a", "c"], "c"],
    ["the last row when its index ran past the end", ["a", "b", "c"], "c", ["a", "b"], "b"],
  ])("moves focus from a removed row to %s", (_name, before, focused, after, expected) => {
    const { container, node } = setup(before);
    (node(focused) as HTMLElement).focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    keepFocus(container, () => reconcileRows(container, after, rows));

    expect((document.activeElement as HTMLElement).textContent).toBe(expected);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("moves focus to the container when no row is left", () => {
    const { container, node } = setup(["a"]);
    (node("a") as HTMLElement).focus();

    keepFocus(container, () => reconcileRows(container, [], rows));

    expect(document.activeElement).toBe(container);
    expect(container.tabIndex).toBe(-1);
  });

  it("leaves focus alone when the focused row stays", () => {
    const { container, node } = setup(["a", "b"]);
    (node("b") as HTMLElement).focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    keepFocus(container, () => reconcileRows(container, ["b", "a"], rows));

    expect(focus).not.toHaveBeenCalled();
  });
});
