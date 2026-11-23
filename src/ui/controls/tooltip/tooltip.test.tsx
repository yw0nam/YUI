// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tip, TooltipHost } from "./tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  render(
    <TooltipHost>
      <Tip text="Rename">
        <button type="button" data-k="a">
          a
        </button>
      </Tip>
      <Tip text="Remove">
        <button type="button" data-k="b">
          b
        </button>
      </Tip>
    </TooltipHost>,
    { container: document.body.appendChild(document.createElement("div")) },
  );
  return {
    a: document.querySelector<HTMLElement>('[data-k="a"]')!,
    b: document.querySelector<HTMLElement>('[data-k="b"]')!,
  };
}

const shown = () => document.querySelector<HTMLElement>(".yui-hint-tip[data-open]");
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
function hoverIn(el: HTMLElement) {
  act(() => {
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    fireEvent.mouseEnter(el);
    fireEvent.mouseMove(el, { movementX: 4, movementY: 4 });
  });
}
function hoverOut(el: HTMLElement) {
  act(() => {
    fireEvent.pointerLeave(el, { pointerType: "mouse" });
    fireEvent.mouseLeave(el);
  });
}
const key = (k: string) => act(() => fireEvent.keyDown(document.body, { key: k }));
const focus = (el: HTMLElement) => act(() => el.focus());

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => cleanup());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Tip", () => {
  it("hover opens at 150 ms, not at 149", () => {
    const { a } = mount();
    hoverIn(a);
    tick(149);
    expect(shown()).toBeNull();
    tick(1);
    expect(shown()?.textContent).toBe("Rename");
  });

  it("leaving before 150 ms cancels the open", () => {
    const { a } = mount();
    hoverIn(a);
    tick(100);
    hoverOut(a);
    tick(100);
    expect(shown()).toBeNull();
  });

  it("keyboard focus after Tab opens at once", () => {
    const { a } = mount();
    key("Tab");
    focus(a);
    expect(shown()?.textContent).toBe("Rename");
  });

  it("a programmatic focus with no focus-moving key since the last pointerdown stays closed", () => {
    const { a } = mount();
    key("Tab");
    act(() => fireEvent.pointerDown(document.body));
    focus(a);
    tick(200);
    expect(shown()).toBeNull();
  });

  it("a pointer click closes an open tip", () => {
    const { a } = mount();
    hoverIn(a);
    tick(150);
    expect(shown()).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(a, { pointerType: "mouse" });
      fireEvent.mouseDown(a);
      fireEvent.mouseUp(a);
      fireEvent.click(a, { detail: 1 });
    });
    tick(1);
    expect(shown()).toBeNull();
  });

  it("shows one popup at a time", () => {
    const { a, b } = mount();
    key("Tab");
    focus(a);
    key("Tab");
    focus(b);
    tick(1);
    expect(shown()?.textContent).toBe("Remove");
    expect(document.querySelectorAll(".yui-hint-tip")).toHaveLength(1);
  });

  it("names the open tip as a tooltip describing its trigger, and drops the description on close", () => {
    const { a, b } = mount();
    key("Tab");
    focus(a);
    expect([shown()?.getAttribute("role"), a.getAttribute("aria-describedby")]).toEqual([
      "tooltip",
      shown()?.id,
    ]);
    key("Tab");
    focus(b);
    tick(1);
    expect(a.hasAttribute("aria-describedby")).toBe(false);
  });

  it("Escape on the focused trigger closes the tip and never reaches the panel's listener", () => {
    const panel = vi.fn();
    document.addEventListener("keydown", panel);
    try {
      const { a } = mount();
      key("Tab");
      focus(a);
      expect(shown()).not.toBeNull();
      panel.mockClear();
      act(() => fireEvent.keyDown(a, { key: "Escape" }));
      tick(1);
      expect([shown(), panel.mock.calls.length]).toEqual([null, 0]);
    } finally {
      document.removeEventListener("keydown", panel);
    }
  });

  it("Escape with a hover tip open and focus elsewhere closes the tip and reaches the panel", () => {
    const panel = vi.fn();
    document.addEventListener("keydown", panel);
    try {
      const { a } = mount();
      hoverIn(a);
      tick(150);
      expect(shown()).not.toBeNull();
      panel.mockClear();
      act(() => fireEvent.keyDown(document.body, { key: "Escape" }));
      tick(1);
      expect([shown(), panel.mock.calls.length]).toEqual([null, 1]);
    } finally {
      document.removeEventListener("keydown", panel);
    }
  });
});
