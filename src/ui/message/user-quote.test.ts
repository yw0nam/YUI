// @vitest-environment jsdom
/**
 * Tests for the user quote: the user's message on the speech bubble's first line, held
 * through the turn and released on settlement, driven through createSurfaces (the mount
 * that composes user-quote.ts and speech-bubble.ts).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("../surfaces/surfaces.css", () => ({}));
vi.mock("../tokens.css", () => ({}));

import { createReasoningStore } from "../../io/bridge/reasoning/reasoning-store";
import { setLocale, t } from "../i18n";
import { createSurfaces } from "../surfaces/surfaces";
import { noTool } from "../surfaces/test-helpers";

const DWELL = 5000;

describe("user quote — the user's message on the bubble's first line", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  function build(opts: Partial<Parameters<typeof createSurfaces>[0]> = {}): void {
    s = createSurfaces({ tool: noTool, mount, dwellMs: DWELL, ...opts });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    setLocale("en");
    vi.useRealTimers();
  });

  const bubble = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble")!;
  const box = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble__box")!;
  const quote = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble__quote")!;
  const who = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble__quote-who")!;
  const quoteText = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble__quote-text")!;
  const speechText = (): HTMLElement => mount.querySelector<HTMLElement>(".yui-bubble__text")!;
  const shown = (): boolean => !bubble().hidden && bubble().classList.contains("is-visible");

  function reply(text: string): void {
    s.beginSpeech();
    s.pushSpeech(text);
    s.endSpeech();
  }

  it("quoteUser shows the bubble with the label and the text, no caret, quote first in the box", () => {
    build();

    s.quoteUser({ text: "오늘 일정 알려줘", via: "text", images: 0 });
    vi.advanceTimersByTime(20);

    expect(shown()).toBe(true);
    expect(bubble().classList.contains("is-streaming")).toBe(false);
    expect(box().firstElementChild).toBe(quote());
    expect(quote().hidden).toBe(false);
    expect(who().textContent).toBe(t("bubble.you"));
    expect(who().querySelector("svg")).toBeNull();
    expect(quoteText().textContent).toBe("오늘 일정 알려줘");
  });

  it("a voice quote carries the mic glyph", () => {
    build();

    s.quoteUser({ text: "hello", via: "voice", images: 0 });

    expect(mount.querySelector(".yui-bubble__quote-who svg")).not.toBeNull();
  });

  it("an images-only quote reads the attachment count; text with images appends it in parentheses", () => {
    build();

    s.quoteUser({ text: "", via: "text", images: 2 });
    expect(quoteText().textContent).toBe(t("bubble.quote_attached", { count: 2 }));

    s.quoteUser({ text: "look", via: "text", images: 1 });
    expect(quoteText().textContent).toBe(`look (${t("bubble.quote_attached", { count: 1 })})`);
  });

  it("the reply streams under the quote", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });

    reply("Hi");
    vi.advanceTimersByTime(DWELL + 500);

    expect(quote().hidden).toBe(false);
    expect(speechText().textContent).toBe("Hi");
    expect(shown()).toBe(true);
  });

  it("a filler phrase does not fade the held bubble", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });

    s.beginSpeech();
    s.pushSpeech("Hmm.");
    s.endSpeech({ defer: true });
    s.finishSpeech();
    vi.advanceTimersByTime(DWELL + 500);

    expect(shown()).toBe(true);
    expect(quote().hidden).toBe(false);
  });

  it("settleQuote hands the bubble to the dwell and the quote hides with it", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });
    reply("Hi");

    s.settleQuote();
    vi.advanceTimersByTime(DWELL - 100);
    expect(shown()).toBe(true);
    vi.advanceTimersByTime(600);

    expect(bubble().hidden).toBe(true);
    expect(quote().hidden).toBe(true);
  });

  it("settleQuote with the quote alone dwells then hides", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });

    s.settleQuote();
    vi.advanceTimersByTime(DWELL - 100);
    expect(shown()).toBe(true);
    vi.advanceTimersByTime(600);

    expect(bubble().hidden).toBe(true);
    expect(quote().hidden).toBe(true);
  });

  it("clearQuote with nothing else showing hides at once", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });

    s.clearQuote();
    vi.advanceTimersByTime(400);

    expect(bubble().hidden).toBe(true);
    expect(quote().hidden).toBe(true);
  });

  it("a settled quote does not come back for speech from another origin", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });
    s.settleQuote();

    s.beginSpeech();
    vi.advanceTimersByTime(20);

    expect(shown()).toBe(true);
    expect(quote().hidden).toBe(true);
  });

  it("a settled quote does not come back for a reasoning reveal", () => {
    const reasoning = createReasoningStore();
    build({ reasoning });
    s.quoteUser({ text: "hi", via: "text", images: 0 });
    s.settleQuote();

    reasoning.append("x");
    vi.advanceTimersByTime(20);

    expect(shown()).toBe(true);
    expect(quote().hidden).toBe(true);
  });

  it("a new quote replaces the previous reply's text", () => {
    build();
    reply("Reply one.");

    s.quoteUser({ text: "next question", via: "text", images: 0 });

    expect(speechText().textContent).toBe("");
    expect(quoteText().textContent).toBe("next question");
  });

  it("a dismissed quote does not revive", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });
    vi.advanceTimersByTime(20);

    mount.querySelector<HTMLButtonElement>(".yui-bubble__close")!.click();
    vi.advanceTimersByTime(400);
    expect(bubble().hidden).toBe(true);
    expect(quote().hidden).toBe(true);

    s.beginSpeech();
    s.pushSpeech("Late reply");
    vi.advanceTimersByTime(20);
    expect(shown()).toBe(true);
    expect(quote().hidden).toBe(true);

    s.settleQuote();
    expect(shown()).toBe(true);
    expect(quote().hidden).toBe(true);
  });

  it("keep-until-dismissed holds a quote-alone bubble", () => {
    build({ keepBubbleUntilDismissed: () => true });
    s.quoteUser({ text: "hi", via: "text", images: 0 });

    s.settleQuote();
    vi.advanceTimersByTime(DWELL * 2);

    expect(shown()).toBe(true);
    expect(bubble().classList.contains("is-held")).toBe(true);
    expect(quote().hidden).toBe(false);
  });

  it("the label follows the display language", () => {
    build();
    s.quoteUser({ text: "hi", via: "text", images: 0 });

    setLocale("ko");

    expect(who().textContent).toBe("나");
  });
});

describe("surfaces.css — the quoted line", () => {
  const css = readFileSync(resolve(__dirname, "../surfaces/surfaces.css"), "utf-8");
  const block = (selector: string): string => {
    const start = css.indexOf(`\n${selector} {`);
    if (start === -1) throw new Error(`selector not found: ${selector}`);
    return css.slice(start, css.indexOf("\n}", start + 1));
  };

  it("clamps the text to two lines", () => {
    expect(block(".yui-bubble__quote-text")).toMatch(/-webkit-line-clamp:\s*2;/);
  });

  it("sizes the line from the speech size, dimmed, never from the panel body size", () => {
    const rule = block(".yui-bubble__quote");
    expect(rule).toMatch(/font-size:\s*0\.9em;/);
    expect(rule).toMatch(/color:\s*var\(--yui-text-mute\);/);
    expect(rule).not.toMatch(/--yui-fs-body/);
  });

  it("hides the slot while it is hidden, which its flex display would otherwise override", () => {
    expect(block(".yui-bubble__quote[hidden]")).toMatch(/display:\s*none;/);
  });
});
