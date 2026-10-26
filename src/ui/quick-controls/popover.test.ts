// @vitest-environment jsdom
/**
 * popover.test.ts — the panel shell: open() moves focus to the first control, and Escape
 * closes the settings window.
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

describe("createPopover", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function makePopover(root = buildRoot()) {
    return {
      root,
      pop: createPopover({ mount, root, onOpen: () => {}, onClose: () => {} }),
    };
  }

  it("Escape runs onClose and closeWindow once and stays open", () => {
    const onClose = vi.fn();
    const closeWindow = vi.fn();
    const pop = createPopover({
      mount,
      root: buildRoot(),
      closeWindow,
      onOpen: () => {},
      onClose,
    });
    pop.open();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pop.isOpen()).toBe(true);

    pop.dispose();
  });

  it("an Escape inside an open dialog leaves the window open", () => {
    const closeWindow = vi.fn();
    const pop = createPopover({
      mount,
      root: buildRoot(),
      closeWindow,
      onOpen: () => {},
      onClose: () => {},
    });
    pop.open();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.setAttribute("open", "");

    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(closeWindow).not.toHaveBeenCalled();
    dialog.remove();
    pop.dispose();
  });

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

  // The panel must not open with a lit ring; the ring comes back on the first Tab.
  it("open() moves focus without a visible focus ring", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const { root, pop } = makePopover();
    pop.open();

    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ focusVisible: false }));
    expect(focus.mock.contexts.at(-1)).toBe(root.querySelector("button"));

    pop.dispose();
  });

  it("open() skips roving-tabindex members Tab never reaches and lands on the roving stop", () => {
    const root = document.createElement("div");
    const [skipped, stop] = ["skipped", "stop"].map((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      return b;
    });
    skipped!.tabIndex = -1;
    root.append(skipped!, stop!);
    const { pop } = makePopover(root);
    pop.open();

    expect(document.activeElement).toBe(stop);

    pop.dispose();
  });
});
