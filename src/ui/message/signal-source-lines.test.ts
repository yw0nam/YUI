// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceLine } from "../../io/bridge/message/message-bridge";
import { setLocale } from "../i18n";
import { createSignalSourceLines } from "./signal-source-lines";
import { createUserQuote } from "./user-quote";

const line = (n: number): SourceLine => ({ delivery: "batched", source: "gh", text: `line ${n}` });

function build() {
  const el = document.createElement("div");
  el.hidden = true;
  const bubble = {
    holdForTurn: vi.fn(),
    measure: vi.fn(),
    reveal: vi.fn(),
    release: vi.fn(),
  };
  return { el, bubble, sources: createSignalSourceLines({ el, bubble }) };
}

describe("createSignalSourceLines", () => {
  beforeEach(() => setLocale("en"));

  it("shows three rows and a more-row for four lines, holding the bubble without revealing", () => {
    const { el, bubble, sources } = build();
    sources.show([line(1), line(2), line(3), line(4)]);

    expect(el.hidden).toBe(false);
    expect(el.classList.contains("is-sources")).toBe(true);
    expect(el.querySelectorAll(".yui-source")).toHaveLength(3);
    expect(el.querySelector(".yui-bubble__sources-more")!.textContent).toBe("+1 more");
    expect(bubble.holdForTurn).toHaveBeenCalledWith(true);
    expect(bubble.measure).toHaveBeenCalledTimes(1);
    expect(bubble.reveal).not.toHaveBeenCalled();
  });

  it("shows no more-row for two lines", () => {
    const { el, sources } = build();
    sources.show([line(1), line(2)]);

    expect(el.querySelectorAll(".yui-source")).toHaveLength(2);
    expect(el.querySelector(".yui-bubble__sources-more")).toBeNull();
  });

  it("hands the slot back to the user quote, which re-attaches its two spans", () => {
    const { el, bubble, sources } = build();
    sources.show([line(1)]);
    createUserQuote({ el, bubble }).show({ text: "hello", via: "text", images: 0 });

    expect(el.classList.contains("is-sources")).toBe(false);
    expect(el.querySelector(".yui-source")).toBeNull();
    expect(el.querySelector(".yui-bubble__quote-who")!.textContent).toBe("You");
    expect(el.querySelector(".yui-bubble__quote-text")!.textContent).toBe("hello");
  });
});
