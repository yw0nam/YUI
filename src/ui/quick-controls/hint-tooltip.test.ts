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
      const coordinatesReset = tip.style.left === "0px" && tip.style.top === "0px";
      const width = coordinatesReset ? 100 : 30;
      const height = coordinatesReset ? 80 : 20;
      return {
        bottom: 40 + height,
        height,
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

  it("closes an open tooltip on a descendant's non-bubbling scroll", () => {
    const scroller = document.createElement("div");
    root.appendChild(scroller);
    dotA.click();
    scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(openTip()).toBeNull();
  });

  it("closes an open tooltip on resize", () => {
    dotA.click();
    window.dispatchEvent(new Event("resize"));
    expect(openTip()).toBeNull();
  });

  it("removes every listener with its original callback and clears pending work", () => {
    const localRoot = document.createElement("div");
    const localDots = [makeDot("Local A"), makeDot("Local B")];
    localRoot.append(...localDots);
    document.body.appendChild(localRoot);

    const documentAdd = vi.spyOn(document, "addEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const dotListeners = localDots.map((dot) => ({
      add: vi.spyOn(dot, "addEventListener"),
      remove: vi.spyOn(dot, "removeEventListener"),
    }));
    const localTooltip = createHintTooltip({ root: localRoot });

    localDots[0].dispatchEvent(new MouseEvent("mouseenter"));
    localTooltip.dispose();

    const documentClick = documentAdd.mock.calls.find(([name]) => name === "click")![1];
    const documentKeydown = documentAdd.mock.calls.find(([name]) => name === "keydown")![1];
    expect(documentRemove).toHaveBeenCalledWith("click", documentClick);
    expect(documentRemove).toHaveBeenCalledWith("keydown", documentKeydown, true);

    const windowScroll = windowAdd.mock.calls.find(([name]) => name === "scroll")![1];
    const windowResize = windowAdd.mock.calls.find(([name]) => name === "resize")![1];
    expect(windowRemove).toHaveBeenCalledWith("scroll", windowScroll, true);
    expect(windowRemove).toHaveBeenCalledWith("resize", windowResize);

    for (const { add, remove } of dotListeners) {
      for (const eventName of ["mouseenter", "mouseleave", "focus", "blur", "click"]) {
        const callback = add.mock.calls.find(([name]) => name === eventName)![1];
        expect(remove).toHaveBeenCalledWith(eventName, callback);
      }
    }

    for (const dot of localDots) {
      dot.dispatchEvent(new MouseEvent("mouseenter"));
      dot.dispatchEvent(new MouseEvent("mouseleave"));
      dot.dispatchEvent(new FocusEvent("focus"));
      dot.dispatchEvent(new FocusEvent("blur"));
      dot.click();
    }
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    localDots[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(openTip()).toBeNull();
    localRoot.remove();
  });

  it("cancels a pending fade when disposed", () => {
    dotA.focus();
    const tip = openTip()!;
    const remove = vi.spyOn(tip, "remove");
    dotA.blur();

    tooltip.dispose();

    expect(remove).toHaveBeenCalledOnce();
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(remove).toHaveBeenCalledOnce();
    expect(tip.isConnected).toBe(false);
  });

  it("renders the dot's aria-label as the tooltip text", () => {
    dotA.focus();
    expect(openTip()!.textContent).toBe(dotA.getAttribute("aria-label"));
  });
});
