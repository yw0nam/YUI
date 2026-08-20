// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHintTooltip, type HintTooltip } from "./hint-tooltip";

function makeDot(label: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yui-hint-dot";
  button.setAttribute("aria-label", label);
  button.textContent = "?";
  return button;
}

describe("createHintTooltip", () => {
  let root: HTMLElement;
  let dotA: HTMLElement;
  let dotB: HTMLElement;
  let tooltip: HintTooltip;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    dotA = makeDot("Explains the screen-watch section in full detail");
    dotB = makeDot("Explains the rate-cap section in full detail");
    root.append(dotA, dotB);
    document.body.appendChild(root);
    tooltip = createHintTooltip({ root });
  });

  afterEach(() => {
    tooltip.dispose();
    root.remove();
    vi.useRealTimers();
  });

  function openTip(): HTMLElement | null {
    return document.querySelector(".yui-hint-tip.is-open");
  }

  it("does not open before the 150ms hover delay", () => {
    dotA.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(149);
    expect(openTip()).toBeNull();
  });

  it("opens at the 150ms hover delay", () => {
    dotA.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(150);
    expect(openTip()).not.toBeNull();
  });

  it("cancels the pending open when the pointer leaves before the delay", () => {
    dotA.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(100);
    dotA.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(100);
    expect(openTip()).toBeNull();
  });

  it("opens immediately on focus, with no timer advance needed", () => {
    dotA.focus();
    expect(openTip()).not.toBeNull();
  });

  it("closes immediately on blur", () => {
    dotA.focus();
    expect(openTip()).not.toBeNull();
    dotA.blur();
    expect(openTip()).toBeNull();
  });

  it("click pins the tooltip open; a later outside click closes it", () => {
    dotA.click();
    expect(openTip()).not.toBeNull();
    document.body.click();
    expect(openTip()).toBeNull();
  });

  it("clicking the same pinned dot again releases the pin and closes it", () => {
    dotA.click();
    expect(openTip()).not.toBeNull();
    dotA.click();
    expect(openTip()).toBeNull();
  });

  it("keeps dot B's pinned tooltip open after switching from pinned dot A by click", () => {
    dotA.click();
    dotB.click();

    vi.advanceTimersByTime(500);

    expect(openTip()?.textContent).toBe(dotB.getAttribute("aria-label"));
    expect(openTip()?.isConnected).toBe(true);
  });

  it("keeps dot B's pinned tooltip open after switching from pinned dot A by focus", () => {
    dotA.click();
    dotB.focus();

    vi.advanceTimersByTime(500);

    expect(openTip()?.textContent).toBe(dotB.getAttribute("aria-label"));
    expect(openTip()?.isConnected).toBe(true);
  });

  it("consumes Escape only while a tooltip is open", () => {
    const panelKeydown = vi.fn();
    document.addEventListener("keydown", panelKeydown);
    try {
      dotA.focus();
      dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(openTip()).toBeNull();
      expect(panelKeydown).not.toHaveBeenCalled();

      dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(panelKeydown).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("keydown", panelKeydown);
    }
  });

  it("keeps the pinned dot open when another dot is hovered", () => {
    dotA.click();
    dotB.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(150);
    expect(openTip()?.textContent).toBe(dotA.getAttribute("aria-label"));
  });

  it("opens another dot on hover after Escape releases the pin", () => {
    dotA.click();
    dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    dotB.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(150);
    expect(openTip()?.textContent).toBe(dotB.getAttribute("aria-label"));
  });

  it("measures from reset coordinates and clamps a flipped tooltip to the viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    vi.spyOn(dotA, "getBoundingClientRect").mockReturnValue({
      bottom: 20,
      height: 10,
      left: 280,
      right: 290,
      top: 10,
      width: 10,
      x: 280,
      y: 10,
      toJSON: () => ({}),
    });

    dotB.focus();
    const tip = openTip()!;
    tip.style.left = "280px";
    tip.style.top = "40px";
    vi.spyOn(tip, "getBoundingClientRect").mockImplementation(() => {
      const width = tip.style.left === "0px" ? 100 : 30;
      return {
        bottom: 120,
        height: 80,
        left: 0,
        right: width,
        top: 40,
        width,
        x: 0,
        y: 40,
        toJSON: () => ({}),
      };
    });

    dotA.focus();

    expect(tip.style.left).toBe("212px");
    expect(tip.style.top).toBe("8px");
  });

  it.each(["scroll", "resize"])("closes an open tooltip on %s", (eventName) => {
    dotA.click();
    window.dispatchEvent(new Event(eventName));
    expect(openTip()).toBeNull();
  });

  it("removes listeners and clears pending work on dispose", () => {
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const dotRemoves = [dotA, dotB].map((dot) => vi.spyOn(dot, "removeEventListener"));

    dotA.dispatchEvent(new MouseEvent("mouseenter"));
    tooltip.dispose();

    expect(documentRemove).toHaveBeenCalledWith("click", expect.any(Function));
    expect(documentRemove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(windowRemove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(windowRemove).toHaveBeenCalledWith("resize", expect.any(Function));
    for (const remove of dotRemoves) {
      for (const eventName of ["mouseenter", "mouseleave", "focus", "blur", "click"]) {
        expect(remove).toHaveBeenCalledWith(eventName, expect.any(Function));
      }
    }
    vi.advanceTimersByTime(500);
    expect(openTip()).toBeNull();
  });

  it("cancels a pending fade when disposed", () => {
    dotA.focus();
    const tip = openTip()!;
    dotA.blur();

    tooltip.dispose();

    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(tip.isConnected).toBe(false);
  });

  it("renders the dot's aria-label as the tooltip text", () => {
    dotA.focus();
    expect(openTip()!.textContent).toBe(dotA.getAttribute("aria-label"));
  });
});
