// @vitest-environment jsdom
/**
 * popover.test.ts — 포커스 관리(a11y).
 * open() 시 첫 컨트롤로 포커스 이동, close() 시 열기 전 요소로 복원,
 * 그리고 Tab/Shift+Tab 포커스 트랩(popover variant).
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
    // rAF 동기화 — open()의 is-open 전이가 테스트에서 즉시 일어나게.
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
});
