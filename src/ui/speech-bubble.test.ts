// @vitest-environment jsdom
/**
 * Tests for the speech bubble: dwell/scroll/markdown/aria behavior, driven
 * through createSurfaces (the mount that composes speech-bubble.ts).
 *
 * The bubble is height-capped (internal scroll), so the newest text must stay
 * visible — pushSpeech scrolls the bubble to its end after each update.
 * jsdom reports scrollHeight=0, so we stub it to assert the scroll behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("./surfaces.css", () => ({}));
vi.mock("./tokens.css", () => ({}));
vi.mock("./markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./markdown")>();
  return {
    ...actual,
    renderMarkdownInline: vi.fn(actual.renderMarkdownInline),
  };
});

import { INTERACTIVE_OVERLAY_SELECTORS } from "../bootstrap-configured";
import { renderMarkdownInline } from "./markdown";
import { createSurfaces } from "./surfaces";

function makeSurfaces() {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const s = createSurfaces({ mount });
  return { s, mount };
}

describe("pushSpeech — auto-scroll to newest line", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  function stub(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  }

  it("scrolls the bubble to the bottom after pushSpeech", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 240, 240); // scrollTop 0 → at the bottom before the delta
    s.pushSpeech("A long line that overflows the capped bubble height.");
    expect(bubbleEl.scrollTop).toBe(240);
  });

  it("re-scrolls to the new end as more text arrives", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 240, 240);
    s.pushSpeech("First chunk.");
    expect(bubbleEl.scrollTop).toBe(240);

    vi.advanceTimersByTime(50);
    stub(bubbleEl, 480, 240);
    s.pushSpeech(" Second chunk that grows the content further.");
    expect(bubbleEl.scrollTop).toBe(480);
  });
});

describe("pushSpeech — scroll pinning respects the user's scroll position", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  function stub(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  }

  it("preserves scrollTop when the user has scrolled up to re-read", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 240, 240);
    s.pushSpeech("Long overflowing reply.");
    expect(bubbleEl.scrollTop).toBe(240); // pinned while at the bottom

    // user scrolls up to re-read
    bubbleEl.scrollTop = 0;
    vi.advanceTimersByTime(50);
    stub(bubbleEl, 480, 240);
    s.pushSpeech(" More text arrives.");
    expect(bubbleEl.scrollTop).toBe(0); // not yanked back down
  });

  it("keeps pinning while the user stays at the bottom", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 240, 240);
    s.pushSpeech("First chunk.");
    expect(bubbleEl.scrollTop).toBe(240);

    vi.advanceTimersByTime(50);
    stub(bubbleEl, 480, 240);
    s.pushSpeech(" Second chunk.");
    expect(bubbleEl.scrollTop).toBe(480);
  });

  it("treats within-8px of the bottom as pinned", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240);
    bubbleEl.scrollTop = 234; // 480 - 234 - 240 = 6px from the bottom
    s.pushSpeech("More.");
    expect(bubbleEl.scrollTop).toBe(480);
  });

  it("does not yank endSpeech either when the user is reading above", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240);
    s.pushSpeech("Long overflowing reply.");
    bubbleEl.scrollTop = 0;
    s.endSpeech();
    expect(bubbleEl.scrollTop).toBe(0);
  });
});

describe("aria-live — announce once per utterance on settle, not per delta", () => {
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

  function liveRegion(): HTMLElement | null {
    return mount.querySelector(".yui-bubble__sr");
  }

  it("the streaming bubble itself is NOT a live region", () => {
    expect(bubble().getAttribute("aria-live")).toBeNull();
    expect(bubble().getAttribute("role")).not.toBe("status");
  });

  it("provides a separate polite live region for speech", () => {
    const sr = liveRegion();
    expect(sr).not.toBeNull();
    expect(sr!.getAttribute("role")).toBe("status");
    expect(sr!.getAttribute("aria-live")).toBe("polite");
  });

  it("stream deltas do not touch the live region; endSpeech announces the full text once", () => {
    const sr = liveRegion()!;
    s.beginSpeech();
    s.pushSpeech("Hello");
    s.pushSpeech(" there");
    expect(sr.textContent).toBe(""); // nothing announced mid-stream

    s.endSpeech();
    expect(sr.textContent).toBe("Hello there");
  });

  it("announces on endSpeech even when the fade is deferred for TTS", () => {
    const sr = liveRegion()!;
    s.beginSpeech();
    s.pushSpeech("Deferred speech");
    s.endSpeech({ defer: true });
    expect(sr.textContent).toBe("Deferred speech");
  });

  it("does not re-mutate the live region when endSpeech fires again for the same text", () => {
    const sr = liveRegion()!;
    s.beginSpeech();
    s.pushSpeech("Barge-in target");
    s.endSpeech({ defer: true }); // stream end defers the fade for TTS
    const announced = sr.firstChild;
    expect(announced).not.toBeNull();

    s.endSpeech(); // barge-in interrupt re-fires endSpeech with unchanged text
    expect(sr.firstChild).toBe(announced); // same node — no re-announcement mutation
  });

  it("clears the announcement when a new utterance begins", () => {
    const sr = liveRegion()!;
    s.beginSpeech();
    s.pushSpeech("First");
    s.endSpeech();
    expect(sr.textContent).toBe("First");

    s.beginSpeech();
    expect(sr.textContent).toBe("");
  });
});

describe("speech-bubble hide fallback", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function opacityTransitionEnd(el: HTMLElement): void {
    const event = new Event("transitionend") as TransitionEvent & { propertyName: string };
    Object.defineProperty(event, "propertyName", { value: "opacity", configurable: true });
    el.dispatchEvent(event);
  }

  it("hideSpeech settles after 400ms without transitionend and repeated stray hides stay harmless", () => {
    const bubble = mount.querySelector(".yui-bubble") as HTMLElement;
    s.beginSpeech();

    s.hideSpeech();
    s.hideSpeech();
    expect(bubble.hidden).toBe(false);

    vi.advanceTimersByTime(400);
    expect(bubble.hidden).toBe(true);

    s.beginSpeech();
    bubble.classList.add("is-visible");
    opacityTransitionEnd(bubble);
    expect(bubble.hidden).toBe(false);
  });
});

describe("dispose — cancels an in-flight fade fallback", () => {
  it("stops the 400ms fallback from mutating the bubble after teardown mid-fade", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const s = createSurfaces({ mount });
    const bubbleEl = mount.querySelector(".yui-bubble") as HTMLElement;

    s.beginSpeech();
    s.hideSpeech(); // arms the 400ms fade fallback
    s.dispose();
    vi.advanceTimersByTime(400); // fallback would fire here if not cancelled

    expect(bubbleEl.hidden).toBe(false);

    vi.useRealTimers();
    mount.remove();
  });
});

describe("pushSpeech — is-scrollable toggle (top-fade only when overflowing)", () => {
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

  function stub(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  }

  it("does NOT mark a short (non-overflowing) bubble scrollable — first line stays unfaded", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 40, 40); // content fits — no overflow
    s.pushSpeech("Short reply.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(false);
  });

  it("marks an overflowing bubble scrollable so the top fade applies", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240); // content overflows the capped height
    s.pushSpeech("A very long reply that exceeds the capped bubble height.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(true);
  });

  it("clears is-scrollable when content shrinks back to fitting", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240);
    s.pushSpeech("Long overflowing reply.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(true);

    s.beginSpeech(); // replace-on-new resets content
    stub(bubbleEl, 40, 40);
    s.pushSpeech("Short.");
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(false);
  });
});

describe("dwell-pause on hover", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
    s = createSurfaces({ mount, dwellMs: 5000 });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  function stub(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  }

  it("pauses the dwell while hovering an overflowing bubble", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240); // overflows the capped height
    s.pushSpeech("A very long reply that exceeds the capped bubble height.");
    s.endSpeech();
    expect(bubbleEl.classList.contains("is-visible")).toBe(true); // precondition
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(true);

    bubbleEl.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(true); // still reading
  });

  it("resumes the dwell when the pointer leaves", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 480, 240);
    s.pushSpeech("A very long reply that exceeds the capped bubble height.");
    s.endSpeech();

    bubbleEl.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(true); // paused

    bubbleEl.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(false); // resumed → hidden
  });

  it("does NOT pause for a short (non-overflowing) bubble", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    stub(bubbleEl, 40, 40); // fits — not scrollable
    s.pushSpeech("Short reply.");
    s.endSpeech();
    expect(bubbleEl.classList.contains("is-scrollable")).toBe(false);

    bubbleEl.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(6000);
    expect(bubbleEl.classList.contains("is-visible")).toBe(false); // hover did not pause
  });
});

describe("endSpeech — deferred dwell for TTS playback", () => {
  const DWELL = 5000;
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
    s = createSurfaces({ mount, dwellMs: DWELL });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  it("does not auto-hide while deferred, even past the dwell window", () => {
    s.beginSpeech();
    s.pushSpeech("Long answer that is still being spoken aloud.");
    s.endSpeech({ defer: true });
    // way past the fixed dwell — bubble must remain visible while TTS plays.
    vi.advanceTimersByTime(DWELL * 3);
    expect(bubble().classList.contains("is-visible")).toBe(true);
    expect(bubble().hidden).toBe(false);
  });

  it("applies the dwell→fade only after finishSpeech() releases the hold", () => {
    s.beginSpeech();
    s.pushSpeech("Spoken line.");
    s.endSpeech({ defer: true });
    vi.advanceTimersByTime(DWELL * 2);
    expect(bubble().classList.contains("is-visible")).toBe(true);

    s.finishSpeech(); // playback ended → now dwell, then fade
    expect(bubble().classList.contains("is-visible")).toBe(true); // dwell not elapsed
    vi.advanceTimersByTime(DWELL);
    expect(bubble().classList.contains("is-visible")).toBe(false); // faded
  });

  it("non-deferred endSpeech() still fixed-dwell fades (fallback path unchanged)", () => {
    s.beginSpeech();
    s.pushSpeech("No TTS this turn.");
    s.endSpeech();
    expect(bubble().classList.contains("is-visible")).toBe(true);
    vi.advanceTimersByTime(DWELL);
    expect(bubble().classList.contains("is-visible")).toBe(false);
  });

  it("finishSpeech() is a no-op when the bubble is already hidden", () => {
    expect(() => s.finishSpeech()).not.toThrow();
    expect(bubble().hidden).toBe(true);
  });
});

describe("pushSpeech — full markdown rendering", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  it("renders plain text delta as text content", () => {
    s.beginSpeech();
    s.pushSpeech("Hello world");
    const text = mount.querySelector(".yui-bubble__text");
    expect(text?.textContent).toBe("Hello world");
  });

  it("renders **bold** markdown inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("Say **hi** now");
    const strong = mount.querySelector(".yui-bubble__text strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("hi");
  });

  it("renders a markdown list inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("- one\n- two");
    const items = mount.querySelectorAll(".yui-bubble__text li");
    expect(items).toHaveLength(2);
  });

  it("renders a markdown link inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("See [docs](https://example.com)");
    const a = mount.querySelector(".yui-bubble__text a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.textContent).toBe("docs");
  });

  it("renders a markdown image inside the speech bubble", () => {
    s.beginSpeech();
    s.pushSpeech("![Cat](https://example.com/cat.png)");
    const img = mount.querySelector(".yui-bubble__text img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/cat.png");
    expect(img?.getAttribute("alt")).toBe("Cat");
  });

  it("does not render <script> injected via speech delta", () => {
    s.beginSpeech();
    s.pushSpeech("<script>alert(1)</script>");
    const script = mount.querySelector(".yui-bubble__text script");
    expect(script).toBeNull();
  });

  it("accumulates multiple pushSpeech deltas", () => {
    s.beginSpeech();
    s.pushSpeech("Hello ");
    s.pushSpeech("world");
    s.endSpeech();
    const text = mount.querySelector(".yui-bubble__text");
    expect(text?.textContent).toContain("Hello");
    expect(text?.textContent).toContain("world");
  });
});

describe("pushSpeech — throttled markdown rendering", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(renderMarkdownInline).mockClear();
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  it("throttles rapid deltas and flushes the complete text in endSpeech", () => {
    const deltas = Array.from({ length: 20 }, (_, i) => `chunk-${i} `);
    const expected = deltas.join("");

    s.beginSpeech();
    for (const delta of deltas) s.pushSpeech(delta);

    expect(renderMarkdownInline).toHaveBeenCalledTimes(1);
    expect(mount.querySelector(".yui-bubble__text")?.textContent).not.toBe(expected);

    s.endSpeech();

    expect(renderMarkdownInline).toHaveBeenCalledTimes(2);
    expect(renderMarkdownInline).toHaveBeenLastCalledWith(expected);
    expect(mount.querySelector(".yui-bubble__text")?.textContent).toBe(expected);
  });
});

describe("close button — dismiss the bubble by hand", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
    s = createSurfaces({ mount, dwellMs: 5000 });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }
  function closeBtn(): HTMLButtonElement {
    return mount.querySelector(".yui-bubble__close") as HTMLButtonElement;
  }

  it("renders a labelled close button inside the bubble", () => {
    expect(closeBtn()).not.toBeNull();
    expect(bubble().contains(closeBtn())).toBe(true);
    expect(closeBtn().getAttribute("aria-label")).toBeTruthy();
  });

  // The pet window is click-through wherever nothing interactive sits, so the button must be a
  // registered hit-test target — otherwise the OS never delivers the hover or the click.
  it("is registered as an interactive overlay target while the bubble shows", () => {
    expect(mount.querySelector(INTERACTIVE_OVERLAY_SELECTORS[1])).toBeNull();

    s.beginSpeech();
    s.pushSpeech("Hello.");
    s.endSpeech();

    expect(mount.querySelector(INTERACTIVE_OVERLAY_SELECTORS[1])).toBe(closeBtn());
  });

  it("clicking it hides the bubble immediately, without waiting for dwell", () => {
    s.beginSpeech();
    s.pushSpeech("Hello.");
    s.endSpeech();
    expect(bubble().classList.contains("is-visible")).toBe(true);

    closeBtn().click();
    expect(bubble().classList.contains("is-visible")).toBe(false);
  });

  it("stays dismissed when the rest of the stream arrives", () => {
    s.beginSpeech();
    s.pushSpeech("First half");
    closeBtn().click();

    s.pushSpeech(" and second half.");
    expect(bubble().classList.contains("is-visible")).toBe(false);

    s.endSpeech();
    expect(bubble().classList.contains("is-visible")).toBe(false);
  });

  it("shows again on the next utterance", () => {
    s.beginSpeech();
    s.pushSpeech("Dismissed.");
    closeBtn().click();

    s.beginSpeech();
    s.pushSpeech("Next one.");
    s.endSpeech();
    expect(bubble().classList.contains("is-visible")).toBe(true);
    expect(bubble().textContent).toContain("Next one.");
  });

  it("clicking it dismisses a bubble whose fade is deferred for playback", () => {
    s.beginSpeech();
    s.pushSpeech("Long spoken reply.");
    s.endSpeech({ defer: true });
    vi.advanceTimersByTime(60000);
    expect(bubble().classList.contains("is-visible")).toBe(true);

    closeBtn().click();
    expect(bubble().classList.contains("is-visible")).toBe(false);
  });
});

describe("keep bubble until dismissed", () => {
  const DWELL = 5000;
  let mount: HTMLElement;
  let keep: boolean;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers();
    mount = document.createElement("div");
    document.body.appendChild(mount);
    keep = true;
    s = createSurfaces({ mount, dwellMs: DWELL, keepBubbleUntilDismissed: () => keep });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  it("never arms the dwell fade while on", () => {
    s.beginSpeech();
    s.pushSpeech("Stay put.");
    s.endSpeech();

    vi.advanceTimersByTime(DWELL * 10);
    expect(bubble().classList.contains("is-visible")).toBe(true);
  });

  it("marks the held bubble so its close button stays visible", () => {
    s.beginSpeech();
    s.pushSpeech("Stay put.");
    expect(bubble().classList.contains("is-held")).toBe(false);

    s.endSpeech();
    expect(bubble().classList.contains("is-held")).toBe(true);

    s.beginSpeech();
    expect(bubble().classList.contains("is-held")).toBe(false);
  });

  it("finishSpeech does not release a deferred bubble into dwell while on", () => {
    s.beginSpeech();
    s.pushSpeech("Stay put.");
    s.endSpeech({ defer: true });
    s.finishSpeech();

    vi.advanceTimersByTime(DWELL * 10);
    expect(bubble().classList.contains("is-visible")).toBe(true);
  });

  it("the close button still dismisses it", () => {
    s.beginSpeech();
    s.pushSpeech("Stay put.");
    s.endSpeech();
    vi.advanceTimersByTime(DWELL * 10);

    (mount.querySelector(".yui-bubble__close") as HTMLButtonElement).click();
    expect(bubble().classList.contains("is-visible")).toBe(false);
  });

  it("new speech replaces the held bubble", () => {
    s.beginSpeech();
    s.pushSpeech("First.");
    s.endSpeech();
    vi.advanceTimersByTime(DWELL * 10);

    s.beginSpeech();
    s.pushSpeech("Second.");
    s.endSpeech();
    expect(bubble().textContent).toContain("Second.");
    expect(bubble().textContent).not.toContain("First.");
  });

  it("falls back to the dwell fade when off", () => {
    keep = false;
    s.beginSpeech();
    s.pushSpeech("Transient.");
    s.endSpeech();

    vi.advanceTimersByTime(DWELL + 100);
    expect(bubble().classList.contains("is-visible")).toBe(false);
  });
});

// The pop-out button rides beside the dismiss button so the one bubble carries both exits:
// close this utterance, or move speech into the message window for good.
describe("pop-out button — moving speech to the message window", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;
  let onPop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    onPop = vi.fn();
    s = createSurfaces({ mount, onPop });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  const bubble = (): HTMLElement => mount.querySelector(".yui-bubble") as HTMLElement;
  const popBtn = (): HTMLButtonElement =>
    mount.querySelector(".yui-bubble__pop") as HTMLButtonElement;

  it("renders a labelled pop button inside the bubble", () => {
    expect(popBtn()).not.toBeNull();
    expect(bubble().contains(popBtn())).toBe(true);
    expect(popBtn().getAttribute("aria-label")).toBeTruthy();
  });

  it("is registered as an interactive overlay target while the bubble shows", () => {
    const selector = ".yui-bubble.is-visible .yui-bubble__pop";
    expect(INTERACTIVE_OVERLAY_SELECTORS).toContain(selector);
    expect(mount.querySelector(selector)).toBeNull();

    s.beginSpeech();
    s.pushSpeech("Hello.");
    s.endSpeech();

    expect(mount.querySelector(selector)).toBe(popBtn());
  });

  it("reports the pop request on click", () => {
    popBtn().click();
    expect(onPop).toHaveBeenCalledTimes(1);
  });

  it("stays hidden outside Tauri, where there is no second window to pop into", () => {
    expect(popBtn().hidden).toBe(true);
  });
});
