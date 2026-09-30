// @vitest-environment jsdom
/**
 * Tests for surfaces.ts — the compose shim wiring speech-bubble.ts and
 * text-input.ts behind createSurfaces() and forwarding tool status to the
 * ToolStatus it is given. Per-surface behavior is tested alongside its module
 * (speech-bubble.test.ts, text-input.test.ts, status-pill.test.ts); this file
 * covers what the shim owns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("./surfaces.css", () => ({}));
vi.mock("../tokens.css", () => ({}));

import { createReasoningStore } from "../../io/bridge/reasoning-store";
import { createSurfaces } from "./surfaces";
import { noTool } from "./test-helpers";

function makeSurfaces() {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const tool = { showTool: vi.fn(), finishTool: vi.fn(), hideTool: vi.fn() };
  const s = createSurfaces({ mount, tool });
  return { s, mount, tool };
}

describe("tool status — forwarded, never rendered", () => {
  it("hands showTool/finishTool/hideTool to the given ToolStatus and draws no chip of its own", () => {
    const { s, mount, tool } = makeSurfaces();

    s.showTool("web_search");
    expect(mount.textContent).not.toContain("Searching…");
    s.finishTool();
    s.hideTool();

    expect(tool.showTool).toHaveBeenCalledWith("web_search");
    expect(tool.finishTool).toHaveBeenCalledTimes(1);
    expect(tool.hideTool).toHaveBeenCalledTimes(1);

    s.dispose();
    mount.remove();
  });
});

describe("bubble ↔ input coordination — input must not obscure the bubble", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }
  function form(): HTMLElement {
    return mount.querySelector(".yui-input") as HTMLElement;
  }

  it("lifts the bubble above the input while the input is open", () => {
    s.beginSpeech();
    s.pushSpeech("I am speaking while you open the input.");
    // anchor the input near the feet, then summon it
    s.setInputAnchor(40);
    s.summonInput();

    // form is revealed synchronously (is-open is rAF-gated, so check hidden)
    expect(form().hidden).toBe(false);
    // bubble enters an input-aware mode and gets a lifted bottom anchor
    expect(bubble().classList.contains("is-above-input")).toBe(true);
    expect(bubble().style.getPropertyValue("--yui-bubble-bottom")).not.toBe("");
  });

  it("restores the bubble's normal position when the input closes", () => {
    s.beginSpeech();
    s.pushSpeech("Speaking.");
    s.setInputAnchor(40);
    s.summonInput();
    expect(bubble().classList.contains("is-above-input")).toBe(true);

    s.dismissInput();
    // dismiss animates out; drive the transitionend that finalises close
    const te = new Event("transitionend") as TransitionEvent & { propertyName: string };
    Object.defineProperty(te, "propertyName", { value: "opacity", configurable: true });
    form().dispatchEvent(te);

    expect(bubble().classList.contains("is-above-input")).toBe(false);
    expect(bubble().style.getPropertyValue("--yui-bubble-bottom")).toBe("");
  });

  it("tracks the feet anchor changing while the input stays open", () => {
    s.setInputAnchor(40);
    s.summonInput();
    const first = bubble().style.getPropertyValue("--yui-bubble-bottom");

    // feet move up → input bottom grows → bubble must lift further
    s.setInputAnchor(160);
    const second = bubble().style.getPropertyValue("--yui-bubble-bottom");

    expect(parseFloat(second)).toBeGreaterThan(parseFloat(first));
  });
});

describe("bubble structure — edge tools outside the scrolling box", () => {
  it("keeps the tools out of the box, and the box holds the text", () => {
    const { s, mount } = makeSurfaces();
    const bubble = mount.querySelector<HTMLElement>(".yui-bubble")!;
    const tools = bubble.querySelector<HTMLElement>(".yui-bubble__tools")!;
    const box = bubble.querySelector<HTMLElement>(".yui-bubble__box")!;

    expect(tools.parentElement).toBe(bubble);
    expect(box.parentElement).toBe(bubble);
    expect(box.contains(tools)).toBe(false);
    expect(box.querySelector(".yui-bubble__text")).not.toBeNull();
    expect(box.querySelector(".yui-bubble__caret")).not.toBeNull();

    s.dispose();
    mount.remove();
  });

  it("marks the bubble scrollable when the box overflows", () => {
    const { s, mount } = makeSurfaces();
    const bubble = mount.querySelector<HTMLElement>(".yui-bubble")!;
    const box = bubble.querySelector<HTMLElement>(".yui-bubble__box")!;
    Object.defineProperty(box, "scrollHeight", { value: 480, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 240, configurable: true });

    s.beginSpeech();
    s.pushSpeech("A reply longer than the box.");

    expect(bubble.classList.contains("is-scrollable")).toBe(true);

    s.dispose();
    mount.remove();
  });
});

describe("composer — three equal icon buttons", () => {
  it("renders attach, pop-out and send as buttons carrying an SVG and no glyph text", () => {
    const { s, mount } = makeSurfaces();
    const buttons = [...mount.querySelectorAll<HTMLButtonElement>(".yui-input__row > button")];

    const names = ["yui-input__attach", "yui-input__pop", "yui-input__send"];
    expect(buttons).toHaveLength(3);
    buttons.forEach((button, i) => {
      expect(button.classList.contains(names[i])).toBe(true);
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent?.trim()).toBe("");
    });

    s.dispose();
    mount.remove();
  });
});

describe("reasoning disclosure — message window only", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    mount.remove();
    vi.useRealTimers();
  });

  const bubble = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble")!;
  const think = (): HTMLDetailsElement =>
    mount.querySelector<HTMLDetailsElement>(".yui-bubble__think")!;
  const thinkText = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble__think-text")!;
  const shown = (): boolean => !bubble().hidden && bubble().classList.contains("is-visible");

  function build() {
    const reasoning = createReasoningStore();
    const s = createSurfaces({ mount, tool: noTool, reasoning });
    return { s, reasoning };
  }

  it("renders no disclosure in the pet window, which passes no reasoning", () => {
    const s = createSurfaces({ mount, tool: noTool });
    expect(mount.querySelector(".yui-bubble__think")).toBeNull();
    s.dispose();
  });

  it("sits inside the box, before the text, and stays hidden while the text is empty", () => {
    const { s } = build();
    const box = mount.querySelector<HTMLElement>(".yui-bubble__box")!;

    expect(box.firstElementChild).toBe(think());
    expect(think().hidden).toBe(true);
    s.dispose();
  });

  it("shows the bubble with the disclosure open on the first live delta, before any speech", () => {
    const { s, reasoning } = build();

    reasoning.append("checking the logs");
    vi.advanceTimersByTime(20);

    expect(shown()).toBe(true);
    expect(think().hidden).toBe(false);
    expect(think().open).toBe(true);
    expect(thinkText().textContent).toBe("checking the logs");
    expect(mount.querySelector(".yui-bubble__text")!.textContent).toBe("");
    s.dispose();
  });

  it("keeps the live text scrolled to its end", () => {
    const { s, reasoning } = build();
    reasoning.append("line one");
    Object.defineProperty(thinkText(), "scrollHeight", { value: 300, configurable: true });

    reasoning.append("\nline two");

    expect(thinkText().scrollTop).toBe(300);
    s.dispose();
  });

  it("closes the disclosure when the reasoning is finalized, keeping the text", () => {
    const { s, reasoning } = build();
    reasoning.append("hmm");

    reasoning.finish("hmm, done");

    expect(think().hidden).toBe(false);
    expect(think().open).toBe(false);
    expect(thinkText().textContent).toBe("hmm, done");
    s.dispose();
  });

  // Only the first delta of a live cycle reveals the bubble, so hiding it sticks for stale text.
  it("does not bring a hidden bubble back for a finalized reasoning update", () => {
    const { s, reasoning } = build();
    reasoning.append("hmm");
    vi.advanceTimersByTime(20);
    expect(shown()).toBe(true);

    s.hideSpeech();
    vi.advanceTimersByTime(400);
    expect(bubble().hidden).toBe(true);

    reasoning.append(" more");
    reasoning.finish("hmm more");
    vi.advanceTimersByTime(20);

    expect(bubble().hidden).toBe(true);
    expect(bubble().classList.contains("is-visible")).toBe(false);
    s.dispose();
  });
});
