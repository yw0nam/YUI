// @vitest-environment jsdom
/**
 * reasoning-chip.test.ts — the reasoning pill on the popped-out window's plate row.
 *
 * Hidden while there is no reasoning text, open while a cycle streams, closed by every render,
 * toggled by tap. Layout, the six-line clip and the animations are pinned statically in
 * surface-doctrine.test.ts — jsdom does no layout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./reasoning-chip.css", () => ({}));

import type { ReasoningState } from "../io/reasoning-store";
import { setLocale, t } from "./i18n";
import { createReasoningChip } from "./reasoning-chip";

function fakePort(initial: ReasoningState = { text: "", live: false }) {
  let state = initial;
  const subs = new Set<(s: ReasoningState) => void>();
  return {
    get: () => state,
    subscribe(cb: (s: ReasoningState) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    set(next: ReasoningState): void {
      state = next;
      for (const cb of subs) cb(next);
    },
  };
}

describe("createReasoningChip", () => {
  let mount: HTMLElement;
  let store: ReturnType<typeof fakePort>;

  beforeEach(() => {
    setLocale("ko");
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  function build(suppressed = false) {
    store = fakePort();
    const chip = createReasoningChip({ mount, store, suppressed });
    return { store, chip };
  }

  function rootEl(): HTMLElement {
    return mount.querySelector<HTMLElement>(".yui-think")!;
  }

  function chipButton(): HTMLButtonElement {
    return mount.querySelector<HTMLButtonElement>(".yui-think__chip")!;
  }

  function panelEl(): HTMLElement {
    return mount.querySelector<HTMLElement>(".yui-think__panel")!;
  }

  function textEl(): HTMLElement {
    return mount.querySelector<HTMLElement>(".yui-think__text")!;
  }

  it("is hidden while there is no reasoning text", () => {
    build();
    expect(rootEl().hidden).toBe(true);
    expect(panelEl().hidden).toBe(true);
  });

  it("appears and opens on the first live state", () => {
    build();

    store.set({ text: "A", live: true });

    expect(rootEl().hidden).toBe(false);
    expect(panelEl().hidden).toBe(false);
    expect(chipButton().getAttribute("aria-expanded")).toBe("true");
    expect(mount.querySelector<HTMLElement>(".yui-think__caret")!.textContent).toBe("▴");
  });

  it("carries the label and the collapsed caret before anything opens", () => {
    build();

    store.set({ text: "A", live: true });
    store.set({ text: "AB", live: false });

    expect(mount.querySelector<HTMLElement>(".yui-think__label")!.textContent).toBe(
      t("think.chip"),
    );
    expect(mount.querySelector<HTMLElement>(".yui-think__caret")!.textContent).toBe("▾");
  });

  it("shows the streamed text and marks live on the button and the text", () => {
    build();

    store.set({ text: "A", live: true });
    store.set({ text: "AB", live: true });

    expect(textEl().textContent).toBe("AB");
    expect(chipButton().classList.contains("is-live")).toBe(true);
    expect(textEl().classList.contains("is-live")).toBe(true);
  });

  it("auto-scrolls the text to the bottom on a live update", () => {
    build();
    const text = textEl();
    Object.defineProperty(text, "scrollHeight", { value: 500, configurable: true });

    store.set({ text: "A", live: true });

    expect(text.scrollTop).toBe(500);
  });

  it("closes the panel when the cycle ends and drops the live marks", () => {
    build();
    store.set({ text: "A", live: true });

    store.set({ text: "AB", live: false });

    expect(panelEl().hidden).toBe(true);
    expect(chipButton().getAttribute("aria-expanded")).toBe("false");
    expect(chipButton().classList.contains("is-live")).toBe(false);
    expect(textEl().classList.contains("is-live")).toBe(false);
    expect(rootEl().hidden).toBe(false);
    expect(textEl().textContent).toBe("AB");
  });

  it("hides again once the text empties", () => {
    build();
    store.set({ text: "A", live: true });

    store.set({ text: "", live: false });

    expect(rootEl().hidden).toBe(true);
  });

  it("closes on every not-live update, even a manual open from a finished cycle", () => {
    build();
    store.set({ text: "AB", live: false });
    chipButton().click();
    expect(panelEl().hidden).toBe(false);

    store.set({ text: "ABC", live: false });

    expect(panelEl().hidden).toBe(true);
  });

  it("toggles the panel on tap", () => {
    build();
    store.set({ text: "AB", live: false });
    expect(panelEl().hidden).toBe(true);

    chipButton().click();
    expect(panelEl().hidden).toBe(false);
    expect(chipButton().getAttribute("aria-expanded")).toBe("true");
    expect(mount.querySelector<HTMLElement>(".yui-think__caret")!.textContent).toBe("▴");

    chipButton().click();
    expect(panelEl().hidden).toBe(true);
    expect(chipButton().getAttribute("aria-expanded")).toBe("false");
    expect(mount.querySelector<HTMLElement>(".yui-think__caret")!.textContent).toBe("▾");
  });

  it("keeps closePanel() idempotent", () => {
    const { chip } = build();
    store.set({ text: "A", live: true });

    chip.closePanel();
    expect(() => chip.closePanel()).not.toThrow();
    expect(panelEl().hidden).toBe(true);
  });

  it("fires onPanelOpen once per closed → open transition, from the automatic open and a tap", () => {
    const { chip } = build();
    const onOpen = vi.fn();
    const off = chip.onPanelOpen(onOpen);

    store.set({ text: "A", live: true });
    expect(onOpen).toHaveBeenCalledTimes(1);

    chip.closePanel();
    chipButton().click();
    expect(onOpen).toHaveBeenCalledTimes(2);

    off();
    chip.closePanel();
    chipButton().click();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("stays hidden while suppressed and returns when unsuppressed", () => {
    const { chip } = build(true);

    store.set({ text: "A", live: true });
    expect(rootEl().hidden).toBe(true);
    expect(panelEl().hidden).toBe(true);

    chip.setSuppressed(false);
    expect(rootEl().hidden).toBe(false);
  });

  it("opens the panel when a live cycle is unsuppressed mid-stream", () => {
    const { chip } = build(true);
    store.set({ text: "A", live: true });

    chip.setSuppressed(false);

    expect(panelEl().hidden).toBe(false);
    expect(chipButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("relabels on a locale change", () => {
    build();
    store.set({ text: "A", live: true });
    expect(mount.querySelector<HTMLElement>(".yui-think__label")!.textContent).toBe("추론");

    setLocale("en");

    expect(mount.querySelector<HTMLElement>(".yui-think__label")!.textContent).toBe("Reasoning");
    expect(chipButton().getAttribute("aria-label")).toBe(t("aria.think_toggle"));
  });

  it("keeps a tap-opened panel open across a locale change", () => {
    build();
    store.set({ text: "A", live: false });
    chipButton().click();
    expect(panelEl().hidden).toBe(false);

    setLocale("en");

    expect(panelEl().hidden).toBe(false);
  });

  it("replaces the text and reopens on a second turn", () => {
    build();
    store.set({ text: "A", live: true });
    store.set({ text: "AB", live: false });
    expect(panelEl().hidden).toBe(true);

    store.set({ text: "C", live: true });

    expect(textEl().textContent).toBe("C");
    expect(panelEl().hidden).toBe(false);
  });

  it("stops listening and removes itself on dispose", () => {
    const { chip } = build();
    const onOpen = vi.fn();
    chip.onPanelOpen(onOpen);
    store.set({ text: "A", live: true });
    const before = chip.el.outerHTML;

    chip.dispose();

    store.set({ text: "AB", live: false });
    expect(chip.el.outerHTML).toBe(before);
    expect(chip.el.isConnected).toBe(false);

    store.set({ text: "ABC", live: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
