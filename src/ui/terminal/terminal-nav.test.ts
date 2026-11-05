// @vitest-environment jsdom
/** terminal-nav.test.ts — a snapshot keeps each terminal's row and the nodes inside it, and does not move focus off an unselected row. */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "../../contract";
import { createTerminalNav } from "./terminal-nav";

function terminal(id: string): Terminal {
  return {
    id,
    owner: { kind: "user" },
    title: `~/${id}`,
    openedAt: 1,
    exitCode: null,
    access: null,
    lastCommand: null,
  } as Terminal;
}

function setup() {
  const nav = createTerminalNav({
    className: "nav",
    html: `<button data-new></button><div data-items></div>`,
    label: () => "terminals",
    labelNew() {},
    item(term) {
      const el = document.createElement("button");
      el.innerHTML = `<span class="name"></span><span class="status"></span>`;
      el.querySelector(".name")!.textContent = term.title;
      el.querySelector(".status")!.textContent = term.exitCode === null ? "running" : "exited";
      return el;
    },
    empty: { className: "empty", text: () => "none" },
    onSelect() {},
    onNew() {},
  });
  document.body.append(nav.el);
  return nav;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("createTerminalNav", () => {
  it("keeps the row, its inner nodes and focus across a snapshot, with the text updated", () => {
    const nav = setup();
    nav.render([terminal("t1"), terminal("t2")], [], "t2");
    const row = nav.el.querySelector<HTMLElement>('[data-id="t1"]')!;
    const status = row.querySelector(".status")!;
    row.focus();

    nav.render([{ ...terminal("t1"), exitCode: 0 }, terminal("t2")], [], "t2");

    expect(nav.el.querySelector('[data-id="t1"]')).toBe(row);
    expect(row.querySelector(".status")).toBe(status);
    expect(status.textContent).toBe("exited");
    expect(row.getAttribute("aria-current")).toBe("false");
    expect(document.activeElement).toBe(row);
  });

  it("focusSelected focuses the selected terminal without scrolling", () => {
    const nav = setup();
    nav.render([terminal("t1"), terminal("t2")], [], "t2");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    nav.focusSelected();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
