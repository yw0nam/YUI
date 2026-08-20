// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHintTooltip, type HintTooltip } from "./hint-tooltip";

function makeDot(label: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "yui-hint-dot";
  span.setAttribute("role", "button");
  span.tabIndex = 0;
  span.setAttribute("aria-label", label);
  span.textContent = "?";
  return span;
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

  it("Enter/Space on a focused dot also toggles the pin", () => {
    dotA.focus();
    dotA.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Focus already opened it; Enter pins the same open tooltip rather than closing it.
    expect(openTip()).not.toBeNull();
    dotA.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(openTip()).toBeNull();
  });

  it("Escape closes the open tooltip", () => {
    dotA.focus();
    expect(openTip()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(openTip()).toBeNull();
  });

  it("opening dot B's tooltip closes dot A's, and only one tooltip is ever open", () => {
    dotA.focus();
    expect(openTip()?.textContent).toBe(dotA.getAttribute("aria-label"));
    dotB.focus();
    expect(document.querySelectorAll(".yui-hint-tip").length).toBe(1);
    expect(openTip()?.textContent).toBe(dotB.getAttribute("aria-label"));
  });

  it("renders the dot's aria-label as the tooltip text", () => {
    dotA.focus();
    expect(openTip()!.textContent).toBe(dotA.getAttribute("aria-label"));
  });
});
