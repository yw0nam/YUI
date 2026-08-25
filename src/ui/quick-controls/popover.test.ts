// @vitest-environment jsdom
/**
 * popover.test.ts — focus management (a11y).
 * open() moves focus to the first control, close() restores it to the element
 * focused before open, plus the Tab/Shift+Tab focus trap (popover variant).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPopover } from "./popover";

function buildRoot(): HTMLElement {
  const root = document.createElement("div");
  root.className = "yui-quick";
  const a = document.createElement("button");
  a.type = "button";
  a.textContent = "first";
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "last";
  root.append(a, b);
  return root;
}

describe("createPopover — focus management", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    // Sync rAF so open()'s is-open transition happens immediately in the test.
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function makePopover(isWindow = false) {
    const root = buildRoot();
    const scrim = document.createElement("div");
    return {
      root,
      pop: createPopover({
        mount,
        root,
        scrim,
        bar: null,
        isWindow,
        onOpen: () => {},
        onClose: () => {},
      }),
    };
  }

  it("open() moves focus to the first focusable control inside root", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    document.body.appendChild(trigger);
    trigger.focus();

    const { root, pop } = makePopover();
    pop.open();

    expect(root.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).textContent).toBe("first");

    pop.dispose();
  });

  it("close() restores focus to the element focused before open()", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { pop } = makePopover();
    pop.open();
    expect(document.activeElement).not.toBe(trigger);

    pop.close();
    expect(document.activeElement).toBe(trigger);

    pop.dispose();
  });

  it("Tab from the last control wraps to the first (focus trap)", () => {
    const { root, pop } = makePopover();
    pop.open();

    const [first, last] = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    first.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(last);

    pop.dispose();
  });

  it("excludes controls inside hidden tab panels from the focus trap", () => {
    // Mirror the real quick-controls structure — inactive tabs are hidden via [hidden].
    const root = document.createElement("div");
    root.className = "yui-quick";
    const visible = document.createElement("div");
    visible.className = "yui-tabpanel";
    const v1 = document.createElement("button");
    v1.type = "button";
    v1.textContent = "v1";
    const v2 = document.createElement("button");
    v2.type = "button";
    v2.textContent = "v2";
    visible.append(v1, v2);
    const hiddenPanel = document.createElement("div");
    hiddenPanel.className = "yui-tabpanel";
    hiddenPanel.hidden = true;
    const h1 = document.createElement("button");
    h1.type = "button";
    h1.textContent = "h1";
    hiddenPanel.append(h1);
    root.append(visible, hiddenPanel);

    const scrim = document.createElement("div");
    const pop = createPopover({
      mount,
      root,
      scrim,
      bar: null,
      isWindow: false,
      onOpen: () => {},
      onClose: () => {},
    });
    pop.open();

    // Forward Tab: wrap from the last visible control (v2) to the first visible one (v1).
    v2.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(v1);

    // Shift+Tab: from the first control to the last visible control (v2) — not the hidden h1.
    v1.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(v2);
    expect(document.activeElement).not.toBe(h1);

    pop.dispose();
  });

  it("excludes controls inside a collapsed <details> section, but keeps its <summary> reachable", () => {
    // Mirror a collapsed Quick Controls section — its body is present in the DOM but not focusable.
    const root = document.createElement("div");
    root.className = "yui-quick";
    const before = document.createElement("button");
    before.type = "button";
    before.textContent = "before";
    const details = document.createElement("details");
    details.className = "yui-section";
    // No `open` attribute — collapsed.
    const summary = document.createElement("summary");
    summary.textContent = "heading";
    const inside = document.createElement("button");
    inside.type = "button";
    inside.textContent = "inside";
    details.append(summary, inside);
    root.append(before, details);

    const scrim = document.createElement("div");
    const pop = createPopover({
      mount,
      root,
      scrim,
      bar: null,
      isWindow: false,
      onOpen: () => {},
      onClose: () => {},
    });
    pop.open();

    // Forward Tab: wraps from the last reachable control (the collapsed section's own summary)
    // back to the first — never lands on the button hidden inside its collapsed body.
    summary.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(before);
    expect(document.activeElement).not.toBe(inside);

    // Shift+Tab from the first control wraps to the summary, not the hidden button.
    before.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(summary);

    pop.dispose();
  });
});
