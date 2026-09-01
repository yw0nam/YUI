// @vitest-environment jsdom
/**
 * Tests for the text input: anchor/attachments/busy/stop/i18n, driven through
 * createSurfaces (the mount that composes text-input.ts).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("./surfaces.css", () => ({}));
vi.mock("./tokens.css", () => ({}));

import { ATTACHMENT_LIMITS_DEFAULTS } from "../config";
import { setLocale, t } from "./i18n";
import { createSurfaces } from "./surfaces";

const readSrc = (name: string): string => readFileSync(resolve(__dirname, name), "utf-8");

function makeSurfaces() {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const s = createSurfaces({ mount });
  return { s, mount };
}

/** bytes omitted = a 4-byte PNG magic; otherwise a zero-filled blob of that size. */
function pngFile(name: string, bytes?: number): File {
  const data =
    bytes === undefined ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : new Uint8Array(bytes);
  return new File([data], name, { type: "image/png" });
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
    // Decorative thumbnail — alt="" so screen reader skips it.
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

describe("attachment caps — count + per-image size", () => {
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
  function errorEl(): HTMLElement {
    return mount.querySelector(".yui-input__error") as HTMLElement;
  }

  // Paste files in one event, then drain the async data-URL reads.
  async function paste(...files: File[]): Promise<void> {
    field().dispatchEvent(makePasteEvent(files));
    for (let i = 0; i < files.length + 3; i++) await new Promise((r) => setTimeout(r, 0));
  }

  it("caps attachments at the built-in default before any config is applied", async () => {
    const over = ATTACHMENT_LIMITS_DEFAULTS.max_count + 2;
    await paste(...Array.from({ length: over }, (_, i) => pngFile(`img${i}.png`)));

    expect(tray().children.length).toBe(ATTACHMENT_LIMITS_DEFAULTS.max_count);
  });

  it("stops at max_count within one paste and shows the count error", async () => {
    s.setAttachmentLimits({ max_count: 2, max_image_bytes: 1024 });
    await paste(pngFile("a.png"), pngFile("b.png"), pngFile("c.png"));

    expect(tray().children.length).toBe(2);
    expect(errorEl().textContent).toBe(t("input.attach_too_many", { max: 2 }));
    expect(form().classList.contains("is-error")).toBe(true);
  });

  it("keeps the count cap across separate pastes", async () => {
    s.setAttachmentLimits({ max_count: 1, max_image_bytes: 1024 });
    await paste(pngFile("a.png"));
    await paste(pngFile("b.png"));

    expect(tray().children.length).toBe(1);
  });

  it("frees a slot when a chip is removed", async () => {
    s.setAttachmentLimits({ max_count: 1, max_image_bytes: 1024 });
    await paste(pngFile("a.png"));
    (tray().querySelector(".yui-chip__remove") as HTMLButtonElement).click();
    await paste(pngFile("b.png"));

    expect(tray().children.length).toBe(1);
  });

  it("rejects an image over max_image_bytes and keeps the smaller one", async () => {
    s.setAttachmentLimits({ max_count: 5, max_image_bytes: 1024 * 1024 });
    await paste(pngFile("small.png"), pngFile("huge.png", 2 * 1024 * 1024));

    expect(tray().children.length).toBe(1);
    expect(errorEl().textContent).toBe(t("input.attach_too_large", { max: 1 }));
    expect(form().classList.contains("is-error")).toBe(true);
  });

  it("drops in-flight reads when the tray is cleared mid-read", async () => {
    const seen: string[][] = [];
    s.onSubmit((_text, images) => seen.push(images));
    s.setAttachmentLimits({ max_count: 2, max_image_bytes: 1024 });

    field().value = "hi";
    field().dispatchEvent(makePasteEvent([pngFile("a.png"), pngFile("b.png")]));
    // Submit before those reads resolve — the turn goes out and the tray is cleared.
    form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(seen[0].length).toBe(0);
    expect(tray().children.length).toBe(0);

    // …and the abandoned reads hold no slots.
    await paste(pngFile("c.png"), pngFile("d.png"));
    expect(tray().children.length).toBe(2);
  });

  it("submits only the accepted attachments", async () => {
    const seen: string[][] = [];
    s.onSubmit((_text, images) => seen.push(images));
    s.setAttachmentLimits({ max_count: 1, max_image_bytes: 1024 });
    await paste(pngFile("a.png"), pngFile("b.png"));

    field().value = "hi";
    form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(seen[0].length).toBe(1);
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

describe("surfaces — i18n chrome", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    s = createSurfaces({ mount });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    setLocale("en");
  });

  it("uses i18n for the input placeholder and field aria-label", () => {
    const field = mount.querySelector<HTMLInputElement>(".yui-input__field")!;
    expect(field.placeholder).toBe(t("input.placeholder"));
    expect(field.getAttribute("aria-label")).toBe(t("aria.input_field"));
  });

  it("uses i18n for the attach button aria-label", () => {
    const attach = mount.querySelector<HTMLButtonElement>(".yui-input__attach")!;
    expect(attach.getAttribute("aria-label")).toBe(t("aria.attach_image"));
  });

  it("uses i18n for the send button aria-label and toggles to stop when busy", () => {
    const send = mount.querySelector<HTMLButtonElement>(".yui-input__send")!;
    expect(send.getAttribute("aria-label")).toBe(t("aria.send"));
    s.setBusy(true);
    expect(send.getAttribute("aria-label")).toBe(t("aria.stop"));
    s.setBusy(false);
    expect(send.getAttribute("aria-label")).toBe(t("aria.send"));
  });

  it("re-applies static labels on locale change (surfaces is not re-mounted)", () => {
    const field = mount.querySelector<HTMLInputElement>(".yui-input__field")!;
    const attach = mount.querySelector<HTMLButtonElement>(".yui-input__attach")!;
    setLocale("ja");
    expect(field.placeholder).toBe(t("input.placeholder"));
    expect(field.getAttribute("aria-label")).toBe(t("aria.input_field"));
    expect(attach.getAttribute("aria-label")).toBe(t("aria.attach_image"));
    // ja value actually differs from the en value baked at construction
    expect(field.placeholder).not.toBe("Say something…");
  });

  it("preserves the busy state when re-applying labels on locale change", () => {
    const send = mount.querySelector<HTMLButtonElement>(".yui-input__send")!;
    s.setBusy(true);
    setLocale("ja");
    expect(send.getAttribute("aria-label")).toBe(t("aria.stop"));
  });
});

describe("input i18n labels — applied from a single site", () => {
  // The four labels (attach/placeholder/field aria/send aria) must come from one
  // call site (text-input.ts's applyLocaleLabels), not be duplicated into the
  // surfaces.ts template as well — otherwise the two copies can drift.
  it("surfaces.ts template does not bake these labels in independently", () => {
    const surfacesSrc = readSrc("surfaces.ts");
    for (const key of ["aria.attach_image", "input.placeholder", "aria.input_field", "aria.send"]) {
      expect(surfacesSrc).not.toContain(`t("${key}")`);
    }
  });

  it("text-input.ts applies the labels once at construction, not only on locale change", () => {
    const textInputSrc = readSrc("text-input.ts");
    // A direct call (trailing "();") proves construction runs the same function that
    // subscribeLocale(applyLocaleLabels) re-runs on locale change — not a second copy.
    expect(textInputSrc).toMatch(/\bapplyLocaleLabels\(\);/);
  });
});

describe("showInputError — inline fix affordance", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function errorEl(): HTMLElement {
    return mount.querySelector(".yui-input__error") as HTMLElement;
  }

  it("shows the message alone when no action is given", () => {
    s.showInputError("boom");

    expect(errorEl().textContent).toBe("boom");
    expect(errorEl().querySelector(".yui-input__error-action")).toBeNull();
  });

  it("renders an action button that runs its handler on click", () => {
    const onClick = vi.fn();
    s.showInputError("boom", { label: "Open settings", onClick });

    const button = errorEl().querySelector<HTMLButtonElement>(".yui-input__error-action")!;
    expect(button).not.toBeNull();
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("Open settings");
    // Separated, so the alert does not announce message and label as one run-on word.
    expect(errorEl().textContent).toBe("boom Open settings");

    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("drops the action button when the next error carries none", () => {
    s.showInputError("boom", { label: "Open settings", onClick: vi.fn() });
    s.showInputError("later");

    expect(errorEl().querySelector(".yui-input__error-action")).toBeNull();
    expect(errorEl().textContent).toBe("later");
  });

  it("clears the action button when the input is summoned again", () => {
    s.showInputError("boom", { label: "Open settings", onClick: vi.fn() });
    s.summonInput();

    expect(errorEl().querySelector(".yui-input__error-action")).toBeNull();
  });
});

describe("input error clearing — turn start, manual dismiss, existing paths", () => {
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
  function field(): HTMLInputElement {
    return mount.querySelector(".yui-input__field") as HTMLInputElement;
  }
  function errorEl(): HTMLElement {
    return mount.querySelector(".yui-input__error") as HTMLElement;
  }
  function dismissBtn(): HTMLButtonElement | null {
    return errorEl().querySelector<HTMLButtonElement>(".yui-input__error-dismiss");
  }

  it("clears a standing error when a turn starts (busy edge)", () => {
    s.showInputError("boom");
    expect(form().classList.contains("is-error")).toBe(true);

    s.setBusy(true);

    expect(form().classList.contains("is-error")).toBe(false);
    expect(errorEl().textContent).toBe("");
  });

  it("clears the action button too when a turn starts", () => {
    s.showInputError("boom", { label: "Open settings", onClick: vi.fn() });
    s.setBusy(true);

    expect(errorEl().querySelector(".yui-input__error-action")).toBeNull();
  });

  it("keeps the error when the turn ends — the failure is reported before the slot frees", () => {
    s.showInputError("boom");
    s.setBusy(false);

    expect(form().classList.contains("is-error")).toBe(true);
    expect(errorEl().textContent).toBe("boom");
  });

  it("renders a dismiss button with an i18n aria-label", () => {
    s.showInputError("boom");

    const button = dismissBtn()!;
    expect(button).not.toBeNull();
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe(t("aria.dismiss_error"));
    // Icon-only — the alert announces the message, not a stray glyph.
    expect(errorEl().textContent).toBe("boom");
  });

  it("clears the error and returns focus to the input when dismiss is clicked", () => {
    s.summonInput();
    s.showInputError("boom", { label: "Open settings", onClick: vi.fn() });

    dismissBtn()!.click();

    expect(form().classList.contains("is-error")).toBe(false);
    expect(errorEl().textContent).toBe("");
    expect(dismissBtn()).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("clears the error when the user types again", () => {
    s.showInputError("boom");
    field().value = "h";
    field().dispatchEvent(new Event("input", { bubbles: true }));

    expect(form().classList.contains("is-error")).toBe(false);
    expect(errorEl().textContent).toBe("");
  });

  it("clears the error when the input is summoned again", () => {
    s.showInputError("boom");
    s.summonInput();

    expect(form().classList.contains("is-error")).toBe(false);
    expect(errorEl().textContent).toBe("");
  });
});

// The input row carries the same exit as the bubble: while typing, the user can move
// speech and the composer into the message window without leaving the field.
describe("input row pop-out button", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;
  let onPop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    onPop = vi.fn();
    s = createSurfaces({ mount, onPop });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    setLocale("en");
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  const popBtn = (): HTMLButtonElement =>
    mount.querySelector(".yui-input__pop") as HTMLButtonElement;

  it("renders a labelled button in the row, immediately before the send button", () => {
    const row = mount.querySelector(".yui-input__row") as HTMLElement;
    expect(popBtn()).not.toBeNull();
    expect(popBtn().type).toBe("button");
    expect(row.contains(popBtn())).toBe(true);
    expect(popBtn().nextElementSibling).toBe(row.querySelector(".yui-input__send"));
    expect(popBtn().getAttribute("aria-label")).toBe(t("aria.pop_message"));
    expect(popBtn().getAttribute("title")).toBe(t("aria.pop_message"));
  });

  it("reports the pop request on click", () => {
    popBtn().click();
    expect(onPop).toHaveBeenCalledTimes(1);
  });

  it("stays hidden outside Tauri, exactly like the bubble's pop button", () => {
    const bubblePop = mount.querySelector(".yui-bubble__pop") as HTMLButtonElement;
    expect(popBtn().hidden).toBe(true);
    expect(popBtn().hidden).toBe(bubblePop.hidden);
  });

  it("shows in the Tauri runtime, where a second window exists to pop into", () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const other = document.createElement("div");
    document.body.appendChild(other);
    const s2 = createSurfaces({ mount: other });

    const rowPop = other.querySelector(".yui-input__pop") as HTMLButtonElement;
    const bubblePop = other.querySelector(".yui-bubble__pop") as HTMLButtonElement;
    expect(rowPop.hidden).toBe(false);
    expect(rowPop.hidden).toBe(bubblePop.hidden);

    s2.dispose();
    other.remove();
  });

  it("re-applies its label on locale change (surfaces is not re-mounted)", () => {
    setLocale("ja");
    expect(popBtn().getAttribute("aria-label")).toBe(t("aria.pop_message"));
    expect(popBtn().getAttribute("title")).toBe(t("aria.pop_message"));
    expect(popBtn().getAttribute("aria-label")).not.toBe("Move speech to the message window");
  });
});
