// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hoverTip, keyboardFocus, shownTip } from "./tip-test-helpers";
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

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const key = (k: string) => act(() => fireEvent.keyDown(document.body, { key: k }));

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
    hoverTip(a);
    tick(149);
    expect(shownTip()).toBeUndefined();
    tick(1);
    expect(shownTip()).toBe("Rename");
  });

  it("keyboard focus after Tab opens at once", () => {
    const { a } = mount();
    keyboardFocus(a);
    expect(shownTip()).toBe("Rename");
  });

  it("a programmatic focus with no focus-moving key since the last pointerdown stays closed", () => {
    const { a } = mount();
    key("Tab");
    act(() => fireEvent.pointerDown(document.body));
    act(() => a.focus());
    tick(200);
    expect(shownTip()).toBeUndefined();
  });

  it("a pointer click closes an open tip", () => {
    const { a } = mount();
    hoverTip(a);
    tick(150);
    expect(shownTip()).toBe("Rename");
    act(() => {
      fireEvent.pointerDown(a, { pointerType: "mouse" });
      fireEvent.mouseDown(a);
      fireEvent.mouseUp(a);
      fireEvent.click(a, { detail: 1 });
    });
    tick(1);
    expect(shownTip()).toBeUndefined();
  });

  it("shows one popup at a time", () => {
    const { a, b } = mount();
    keyboardFocus(a);
    keyboardFocus(b);
    tick(1);
    expect(shownTip()).toBe("Remove");
    expect(document.querySelectorAll(".yui-hint-tip")).toHaveLength(1);
  });

  it("names the open tip as a tooltip describing its trigger, and drops the description on close", () => {
    const { a, b } = mount();
    keyboardFocus(a);
    const popup = document.querySelector(".yui-hint-tip[data-open]");
    expect([popup?.getAttribute("role"), a.getAttribute("aria-describedby")]).toEqual([
      "tooltip",
      popup?.id,
    ]);
    keyboardFocus(b);
    tick(1);
    expect(a.hasAttribute("aria-describedby")).toBe(false);
  });

  it("Escape on the focused trigger closes the tip and never reaches the panel's listener", () => {
    const panel = vi.fn();
    document.addEventListener("keydown", panel);
    try {
      const { a } = mount();
      keyboardFocus(a);
      expect(shownTip()).toBe("Rename");
      panel.mockClear();
      act(() => fireEvent.keyDown(a, { key: "Escape" }));
      tick(1);
      expect([shownTip(), panel.mock.calls.length]).toEqual([undefined, 0]);
    } finally {
      document.removeEventListener("keydown", panel);
    }
  });

  it("Escape with a hover tip open and focus elsewhere closes the tip and reaches the panel", () => {
    const panel = vi.fn();
    document.addEventListener("keydown", panel);
    try {
      const { a } = mount();
      hoverTip(a);
      tick(150);
      expect(shownTip()).toBe("Rename");
      panel.mockClear();
      act(() => fireEvent.keyDown(document.body, { key: "Escape" }));
      tick(1);
      expect([shownTip(), panel.mock.calls.length]).toEqual([undefined, 1]);
    } finally {
      document.removeEventListener("keydown", panel);
    }
  });
});
