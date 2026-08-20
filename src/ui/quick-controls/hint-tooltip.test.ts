// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHintTooltip, type HintTooltip } from "./hint-tooltip";

function makeDot(label: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yui-hint-dot";
  button.setAttribute("aria-label", label);
  button.dataset.tip = label;
  button.dataset.tipPin = "";
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

  function enterKeyboardModality(key = "Tab"): void {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }

  it("does not open before the 150ms hover delay", () => {
    dotA.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(149);
    expect(openTip()).toBeNull();
  });

  it("opens at the 150ms hover delay", () => {
    dotA.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(150);
    expect(openTip()).not.toBeNull();
  });

  it("cancels the pending open when the pointer leaves before the delay", () => {
    dotA.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(100);
    dotA.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(openTip()).toBeNull();
  });

  it("does not open a pending tooltip after its target is detached", () => {
    dotA.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    dotA.remove();

    vi.advanceTimersByTime(150);

    expect(openTip()).toBeNull();
  });

  it("closes an open tooltip when the pointer leaves a target that was detached", () => {
    dotA.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(150);
    expect(openTip()).not.toBeNull();

    // A re-render replaces the row under the pointer, then the pointer leaves.
    dotA.remove();
    root.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

    expect(openTip()).toBeNull();
  });

  it("closes a focus-opened tooltip when the target is detached before blur", () => {
    enterKeyboardModality();
    dotA.focus();
    expect(openTip()).not.toBeNull();

    // A re-render drops the focused node, so focusout arrives from a detached target.
    dotA.remove();
    root.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    expect(openTip()).toBeNull();
  });

  it("opens immediately on focus after a focus-moving keydown", () => {
    enterKeyboardModality();
    dotA.focus();
    expect(openTip()).not.toBeNull();
  });

  it("closes immediately on blur", () => {
    enterKeyboardModality();
    dotA.focus();
    expect(openTip()).not.toBeNull();
    dotA.blur();
    expect(openTip()).toBeNull();
  });

  it("opens focus tooltips only in keyboard modality and resets on pointerdown", () => {
    dotA.focus();
    expect(openTip()).toBeNull();
    dotA.blur();

    enterKeyboardModality();
    dotA.focus();
    expect(openTip()?.textContent).toBe(dotA.dataset.tip);
    dotA.blur();

    document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    dotA.focus();
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

  it("clicking a non-dot data-tip element hides its focused tooltip", () => {
    const button = document.createElement("button");
    button.dataset.tip = "Switch to reactions";
    root.appendChild(button);

    enterKeyboardModality();
    button.focus();
    expect(openTip()?.textContent).toBe("Switch to reactions");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    expect(openTip()).toBeNull();
  });

  it("keeps a keyboard-activated tooltip open and picks up a data-tip mutated by that activation", () => {
    const button = document.createElement("button");
    button.dataset.tip = "Collapse sections rail";
    root.appendChild(button);
    button.addEventListener("click", () => {
      button.dataset.tip = "Expand sections rail";
    });

    enterKeyboardModality();
    button.focus();
    expect(openTip()?.textContent).toBe("Collapse sections rail");

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));

    expect(openTip()?.textContent).toBe("Expand sections rail");
  });

  it("still hides a keyboard-focused tooltip on a real pointer click (detail >= 1)", () => {
    const button = document.createElement("button");
    button.dataset.tip = "Collapse sections rail";
    root.appendChild(button);

    enterKeyboardModality();
    button.focus();
    expect(openTip()).not.toBeNull();

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    expect(openTip()).toBeNull();
  });

  it("closes an open tooltip when clicking its target detaches it", () => {
    const button = document.createElement("button");
    button.dataset.tip = "Delete";
    button.addEventListener("click", () => button.remove());
    root.appendChild(button);
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(150);

    button.click();

    expect(openTip()).toBeNull();
  });

  it("pins only elements carrying data-tip-pin", () => {
    const button = document.createElement("button");
    button.dataset.tip = "Explicit pin target";
    button.dataset.tipPin = "";
    root.appendChild(button);

    button.click();

    expect(openTip()?.textContent).toBe("Explicit pin target");
    document.body.click();
    expect(openTip()).toBeNull();
  });

  it("keeps dot B's pinned tooltip open after switching from pinned dot A by click", () => {
    dotA.click();
    dotB.click();

    vi.advanceTimersByTime(500);

    expect(openTip()?.textContent).toBe(dotB.dataset.tip);
    expect(openTip()?.isConnected).toBe(true);
  });

  it("keeps dot B's pinned tooltip open after switching from pinned dot A by focus", () => {
    dotA.click();
    enterKeyboardModality();
    dotB.focus();

    vi.advanceTimersByTime(500);

    expect(openTip()?.textContent).toBe(dotB.dataset.tip);
    expect(openTip()?.isConnected).toBe(true);
  });

  it("consumes Escape only while a tooltip is pinned", () => {
    const panelKeydown = vi.fn();
    document.addEventListener("keydown", panelKeydown);
    try {
      enterKeyboardModality();
      panelKeydown.mockClear();
      dotA.focus();
      dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(openTip()).toBeNull();
      expect(panelKeydown).toHaveBeenCalledOnce();

      dotA.click();
      dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(panelKeydown).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("keydown", panelKeydown);
    }
  });

  it("cancels a pending open on Escape before any tooltip is visible", () => {
    dotA.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    root.remove();

    vi.advanceTimersByTime(150);

    expect(openTip()).toBeNull();
  });

  it("keeps the pinned dot open when another dot is hovered", () => {
    dotA.click();
    dotB.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(150);
    expect(openTip()?.textContent).toBe(dotA.dataset.tip);
  });

  it("opens another dot on hover after Escape releases the pin", () => {
    dotA.click();
    dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    dotB.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(150);
    expect(openTip()?.textContent).toBe(dotB.dataset.tip);
  });

  it("keeps the tooltip open when the pointer moves onto an inner svg", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    dotA.appendChild(svg);
    const measure = vi.spyOn(dotA, "getBoundingClientRect");
    dotA.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(150);

    dotA.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: svg }));
    svg.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: dotA }));
    vi.advanceTimersByTime(150);

    expect(openTip()?.textContent).toBe(dotA.dataset.tip);
    expect(measure).toHaveBeenCalledOnce();
  });

  it("wires data-tip elements added after construction", () => {
    const button = document.createElement("button");
    button.dataset.tip = "Added after construction";
    root.appendChild(button);

    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(openTip()?.textContent).toBe("Added after construction");
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

    enterKeyboardModality();
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
    const rootAdd = vi.spyOn(localRoot, "addEventListener");
    const rootRemove = vi.spyOn(localRoot, "removeEventListener");
    const localTooltip = createHintTooltip({ root: localRoot });

    localDots[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    localTooltip.dispose();

    const documentClick = documentAdd.mock.calls.find(([name]) => name === "click")![1];
    const documentKeydowns = documentAdd.mock.calls.filter(([name]) => name === "keydown");
    expect(documentRemove).toHaveBeenCalledWith("click", documentClick);
    expect(documentKeydowns).toHaveLength(2);
    for (const [, callback] of documentKeydowns) {
      expect(documentRemove).toHaveBeenCalledWith("keydown", callback, true);
    }
    const documentPointerdown = documentAdd.mock.calls.find(([name]) => name === "pointerdown")![1];
    expect(documentRemove).toHaveBeenCalledWith("pointerdown", documentPointerdown, true);

    const windowScroll = windowAdd.mock.calls.find(([name]) => name === "scroll")![1];
    const windowResize = windowAdd.mock.calls.find(([name]) => name === "resize")![1];
    expect(windowRemove).toHaveBeenCalledWith("scroll", windowScroll, true);
    expect(windowRemove).toHaveBeenCalledWith("resize", windowResize);

    for (const eventName of ["mouseover", "mouseout", "focusin", "focusout", "click"]) {
      const callback = rootAdd.mock.calls.find(([name]) => name === eventName)![1];
      expect(rootRemove).toHaveBeenCalledWith(eventName, callback);
    }

    for (const dot of localDots) {
      dot.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      dot.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      dot.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      dot.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      dot.click();
    }
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    localDots[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(openTip()).toBeNull();
    localRoot.remove();
  });

  it("cancels a pending fade when disposed", () => {
    enterKeyboardModality();
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

  it("renders data-tip instead of the accessible name as the tooltip text", () => {
    dotA.dataset.tip = "Tooltip copy";
    dotA.setAttribute("aria-label", "Accessible name");
    enterKeyboardModality();
    dotA.focus();
    expect(openTip()!.textContent).toBe("Tooltip copy");
  });

  it("points aria-describedby at the open tooltip and removes it on hide", () => {
    enterKeyboardModality();
    dotA.focus();
    const tip = openTip()!;
    expect(dotA.getAttribute("aria-describedby")).toBe(tip.id);

    dotA.blur();

    expect(dotA.hasAttribute("aria-describedby")).toBe(false);
  });

  it("does not leave aria-describedby on the previous target when the tooltip moves to another", () => {
    dotA.click();
    expect(dotA.getAttribute("aria-describedby")).toBe(openTip()!.id);

    dotB.click();

    expect(dotA.hasAttribute("aria-describedby")).toBe(false);
    expect(dotB.getAttribute("aria-describedby")).toBe(openTip()!.id);
  });
});
