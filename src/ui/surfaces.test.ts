// @vitest-environment jsdom
/**
 * Tests for surfaces.ts speech-bubble auto-scroll.
 *
 * The bubble is height-capped (internal scroll), so the newest text must stay
 * visible — pushSpeech scrolls the bubble to its end after each update.
 * jsdom reports scrollHeight=0, so we stub it to assert the scroll behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("./surfaces.css", () => ({}));
vi.mock("./tokens.css", () => ({}));

import { t } from "./i18n";
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
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }

  it("scrolls the bubble to the bottom after pushSpeech", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    Object.defineProperty(bubbleEl, "scrollHeight", {
      value: 240,
      configurable: true,
    });
    s.pushSpeech("A long line that overflows the capped bubble height.");
    expect(bubbleEl.scrollTop).toBe(240);
  });

  it("re-scrolls to the new end as more text arrives", () => {
    s.beginSpeech();
    const bubbleEl = bubble();
    Object.defineProperty(bubbleEl, "scrollHeight", {
      value: 240,
      configurable: true,
    });
    s.pushSpeech("First chunk.");
    expect(bubbleEl.scrollTop).toBe(240);

    Object.defineProperty(bubbleEl, "scrollHeight", {
      value: 480,
      configurable: true,
    });
    s.pushSpeech(" Second chunk that grows the content further.");
    expect(bubbleEl.scrollTop).toBe(480);
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

describe("setInputAnchor — --yui-input-bottom on the chat form", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function form(): HTMLElement {
    return mount.querySelector(".yui-input") as HTMLElement;
  }

  it("sets --yui-input-bottom to a px value", () => {
    s.setInputAnchor(120);
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("120px");
  });

  it("removes the var when given null", () => {
    s.setInputAnchor(120);
    s.setInputAnchor(null);
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("");
  });

  it("preserves the var across summonInput()/dismissInput()", () => {
    s.setInputAnchor(96);
    s.summonInput();
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("96px");
    s.dismissInput();
    expect(form().style.getPropertyValue("--yui-input-bottom")).toBe("96px");
  });
});

describe("image attachments — tray chips + onSubmit images", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function form(): HTMLFormElement {
    return mount.querySelector(".yui-input") as HTMLFormElement;
  }
  function field(): HTMLInputElement {
    return mount.querySelector(".yui-input__field") as HTMLInputElement;
  }
  function tray(): HTMLElement {
    return mount.querySelector(".yui-input__tray") as HTMLElement;
  }

  function pngFile(name: string): File {
    return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
  }

  function makePasteEvent(files: File[], text = ""): Event & { clipboardData: unknown } {
    const items = files.map((f) => ({ kind: "file" as const, getAsFile: () => f }));
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: unknown;
    };
    Object.defineProperty(e, "clipboardData", {
      value: { items, getData: (type: string) => (type === "text" ? text : "") },
      configurable: true,
    });
    return e;
  }

  // Drive the field paste path with a stubbed clipboard carrying image files,
  // then await the FileReader → data-URL load (microtask + macrotask flush).
  async function pasteImages(...files: File[]): Promise<void> {
    const before = tray().children.length;
    field().dispatchEvent(makePasteEvent(files));
    // FileReader load is async — wait until every dispatched chip has rendered.
    while (tray().children.length < before + files.length) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  function submit(): void {
    form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  it("submits the attached image data URLs alongside text", async () => {
    const seen: Array<[string, string[]]> = [];
    s.onSubmit((text, images) => seen.push([text, images]));

    field().value = "look at this";
    await pasteImages(pngFile("a.png"));

    expect(tray().children.length).toBe(1);
    // 장식용 썸네일 — alt=""로 스크린리더가 건너뛴다.
    expect(tray().querySelector("img")?.alt).toBe("");
    submit();

    expect(seen.length).toBe(1);
    expect(seen[0][0]).toBe("look at this");
    expect(seen[0][1].length).toBe(1);
    expect(seen[0][1][0]).toMatch(/^data:image\/png/);
  });

  it("fires onSubmit for an images-only message (empty field)", async () => {
    const seen: Array<[string, string[]]> = [];
    s.onSubmit((text, images) => seen.push([text, images]));

    field().value = "";
    await pasteImages(pngFile("only.png"));
    submit();

    expect(seen.length).toBe(1);
    expect(seen[0][0]).toBe("");
    expect(seen[0][1].length).toBe(1);
  });

  it("removing a chip drops that image from the next submit", async () => {
    const seen: Array<[string, string[]]> = [];
    s.onSubmit((text, images) => seen.push([text, images]));

    await pasteImages(pngFile("first.png"));
    await pasteImages(pngFile("second.png"));
    await pasteImages(pngFile("third.png"));
    expect(tray().children.length).toBe(3);

    // remove the middle chip
    const middle = tray().children[1] as HTMLElement;
    const remove = middle.querySelector(".yui-chip__remove") as HTMLButtonElement;
    remove.click();
    expect(tray().children.length).toBe(2);

    field().value = "x";
    submit();
    expect(seen[0][1].length).toBe(2);
  });

  it("preserves text on a mixed image+text paste (does not preventDefault)", async () => {
    const e = makePasteEvent([pngFile("a.png")], "some pasted text");
    field().dispatchEvent(e);
    // image still captured…
    while (tray().children.length < 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(tray().children.length).toBe(1);
    // …but the text paste is allowed through (default not prevented)
    expect(e.defaultPrevented).toBe(false);
  });

  it("prevents default on an image-only paste (no clipboard text)", async () => {
    const e = makePasteEvent([pngFile("a.png")], "");
    field().dispatchEvent(e);
    while (tray().children.length < 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(e.defaultPrevented).toBe(true);
  });

  it("clears the tray after submit", async () => {
    s.onSubmit(() => {});
    field().value = "hi";
    await pasteImages(pngFile("a.png"));
    expect(tray().children.length).toBe(1);
    submit();
    expect(tray().children.length).toBe(0);
  });

  it("clears the tray after dismissInput() completes", async () => {
    s.onSubmit(() => {});
    s.summonInput();
    await pasteImages(pngFile("a.png"));
    expect(tray().children.length).toBe(1);

    s.dismissInput();
    const te = new Event("transitionend") as TransitionEvent & { propertyName: string };
    Object.defineProperty(te, "propertyName", { value: "opacity", configurable: true });
    form().dispatchEvent(te);

    expect(tray().children.length).toBe(0);
  });
});

describe("setInputEnabled — disable the field while busy", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function field(): HTMLInputElement {
    return mount.querySelector(".yui-input__field") as HTMLInputElement;
  }
  function form(): HTMLElement {
    return mount.querySelector(".yui-input") as HTMLElement;
  }

  it("disables the field and marks the form pending when disabled", () => {
    s.setInputEnabled(false);
    expect(field().disabled).toBe(true);
    expect(form().classList.contains("is-pending")).toBe(true);
  });

  it("re-enables the field and clears pending when enabled", () => {
    s.setInputEnabled(false);
    s.setInputEnabled(true);
    expect(field().disabled).toBe(false);
    expect(form().classList.contains("is-pending")).toBe(false);
  });
});

describe("setBusy — send ↔ stop toggle on the input form", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function form(): HTMLElement {
    return mount.querySelector(".yui-input") as HTMLElement;
  }
  function sendBtn(): HTMLButtonElement {
    return mount.querySelector(".yui-input__send") as HTMLButtonElement;
  }

  it("adds is-running and shows the stop affordance when busy", () => {
    s.setBusy(true);
    expect(form().classList.contains("is-running")).toBe(true);
    expect(sendBtn().getAttribute("aria-label")).toBe(t("aria.stop"));
  });

  it("reverts to the send affordance when no longer busy", () => {
    s.setBusy(true);
    s.setBusy(false);
    expect(form().classList.contains("is-running")).toBe(false);
    expect(sendBtn().getAttribute("aria-label")).toBe(t("aria.send"));
  });
});

describe("onStop — stop fires only on explicit button click while busy", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function form(): HTMLFormElement {
    return mount.querySelector(".yui-input") as HTMLFormElement;
  }
  function field(): HTMLInputElement {
    return mount.querySelector(".yui-input__field") as HTMLInputElement;
  }
  function sendBtn(): HTMLButtonElement {
    return mount.querySelector(".yui-input__send") as HTMLButtonElement;
  }

  it("fires onStop and NOT onSubmit when the button is clicked while busy", () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    s.onStop(onStop);
    s.onSubmit(onSubmit);
    field().value = "안녕";
    s.setBusy(true);

    sendBtn().click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does NOT fire onSubmit on form submit (Enter) while busy", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    s.onSubmit(onSubmit);
    s.onStop(onStop);
    field().value = "안녕";
    s.setBusy(true);

    form().dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does NOT fire onStop when the button is clicked while idle", () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    s.onStop(onStop);
    s.onSubmit(onSubmit);
    field().value = "안녕";

    // idle button click = submit (type=submit). jsdom doesn't auto-submit on
    // click, so drive the submit path the listener guards.
    form().dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onStop).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("fires onSubmit on Enter / form submit when idle (no regression)", () => {
    const onSubmit = vi.fn();
    s.onSubmit(onSubmit);
    field().value = "안녕";

    form().dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("안녕", []);
  });
});
