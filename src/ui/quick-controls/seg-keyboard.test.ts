// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { handleSegmentKeydown, type SegKeydownConfig } from "./seg-keyboard";

function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
}

function setup(): { buttons: HTMLButtonElement[]; cfg: ReturnType<typeof makeCfg> } {
  const buttons = [0, 1, 2].map(() => {
    const b = document.createElement("button");
    b.className = "yui-seg__btn";
    return b;
  });
  const container = document.createElement("div");
  container.append(...buttons);
  document.body.append(container);
  return { buttons, cfg: makeCfg() };
}

function makeCfg(): SegKeydownConfig {
  return {
    length: 3,
    getBaseIndex: () => 1,
    onNavigate: vi.fn(),
    onCommit: vi.fn(),
  };
}

describe("handleSegmentKeydown", () => {
  it("ArrowRight/ArrowLeft/Home/End navigate from base and preventDefault", () => {
    const { buttons, cfg } = setup();
    const cases: Array<[string, number]> = [
      ["ArrowRight", 2],
      ["ArrowLeft", 0],
      ["Home", 0],
      ["End", 2],
    ];
    for (const [key, expected] of cases) {
      const e = keydown(key);
      handleSegmentKeydown(e, buttons, cfg);
      expect(e.defaultPrevented).toBe(true);
      expect(cfg.onNavigate).toHaveBeenCalledWith(expected, true);
    }
    expect(cfg.onCommit).not.toHaveBeenCalled();
  });

  it("Space/Enter commit the targeted button; without onCommit nothing happens", () => {
    const { buttons, cfg } = setup();
    const commit = keydown("Enter");
    Object.defineProperty(commit, "target", { value: buttons[2] });
    handleSegmentKeydown(commit, buttons, cfg);
    expect(commit.defaultPrevented).toBe(true);
    expect(cfg.onCommit).toHaveBeenCalledWith(2);

    const noCommit = { ...makeCfg(), onCommit: undefined };
    const e = keydown(" ");
    Object.defineProperty(e, "target", { value: buttons[0] });
    handleSegmentKeydown(e, buttons, noCommit);
    expect(e.defaultPrevented).toBe(false);
    expect(noCommit.onNavigate).not.toHaveBeenCalled();
  });

  it("an unrelated key is ignored", () => {
    const { buttons, cfg } = setup();
    const e = keydown("a");
    handleSegmentKeydown(e, buttons, cfg);
    expect(e.defaultPrevented).toBe(false);
    expect(cfg.onNavigate).not.toHaveBeenCalled();
    expect(cfg.onCommit).not.toHaveBeenCalled();
  });
});
