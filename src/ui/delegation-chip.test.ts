// @vitest-environment jsdom
/**
 * delegation-chip.test.ts — the pet-window chip over the delegations store: hidden at zero
 * running, count text, tap-to-toggle list, the 500ms long-press fold and its per-device
 * persistence, and the hit-test registration that lets OS clicks reach it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./delegation-chip.css", () => ({}));

import { INTERACTIVE_OVERLAY_SELECTORS } from "../bootstrap-configured";
import {
  createDelegationChipSettings,
  localStorageDelegationChipStorage,
} from "../io/delegation-chip-settings";
import { createDelegationsStore } from "../io/delegations-store";
import type { DelegationItem } from "../io/push-socket";
import { createDelegationChip } from "./delegation-chip";
import { setLocale, t } from "./i18n";

const NOW = 1_789_365_900_000;
const STORAGE_KEY = "yui.test.delegation-chip";

function running(id: string, startedAgoMs: number): DelegationItem {
  return { id, title: `work ${id}`, started_at: NOW - startedAgoMs, state: "running" };
}

function done(id: string, endedAgoMs: number): DelegationItem {
  return {
    id,
    title: `work ${id}`,
    started_at: NOW - endedAgoMs - 600_000,
    state: "done",
    ended_at: NOW - endedAgoMs,
  };
}

describe("createDelegationChip", () => {
  let mount: HTMLElement;
  let clock: number;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

    setLocale("ko");
    clock = NOW;
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
    setLocale("en");
  });

  function build(storage = localStorageDelegationChipStorage(STORAGE_KEY)) {
    const store = createDelegationsStore({ now: () => clock });
    const collapsed = createDelegationChipSettings({ storage });
    const chip = createDelegationChip({ mount, store, collapsed, now: () => clock });
    return { store, collapsed, chip };
  }

  function chipEl(): HTMLElement {
    return mount.querySelector<HTMLElement>(".yui-deleg")!;
  }

  function chipButton(): HTMLButtonElement {
    return mount.querySelector<HTMLButtonElement>(".yui-deleg__chip")!;
  }

  function listEl(): HTMLElement {
    return mount.querySelector<HTMLElement>(".yui-deleg__list")!;
  }

  /** The fade-out fallback is 400ms — past it, every settle has landed. */
  function settle(): void {
    vi.advanceTimersByTime(400);
  }

  function press(pointerType: "down" | "up"): void {
    chipButton().dispatchEvent(new PointerEvent(`pointer${pointerType}`));
  }

  it("is hidden from the a11y tree when nothing is running", () => {
    const { chip } = build();
    expect(chip.el.hidden).toBe(true);
  });

  it("stays hidden when only finished items remain", () => {
    const { store } = build();
    store.replace([done("d-1", 60_000)]);
    expect(chipEl().hidden).toBe(true);
  });

  it("shows the running count in the label and hides the count badge while expanded", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000), running("d-2", 60_000), done("d-3", 60_000)]);

    expect(chipEl().hidden).toBe(false);
    expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe(
      t("deleg.chip_running", { n: 2 }),
    );
    expect(chipEl().classList.contains("is-mini")).toBe(false);
  });

  it("renders the label in the active locale", () => {
    const { store } = build();
    setLocale("en");
    store.replace([running("d-1", 60_000)]);
    expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe(
      t("deleg.chip_running", { n: 1 }),
    );
  });

  it("uses the house pluralization style in English, not an explicit (s)", () => {
    const { store } = build();
    setLocale("en");
    store.replace([running("d-1", 60_000), running("d-2", 60_000)]);
    expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe(
      "2 tasks in progress",
    );
  });

  it("opens the list popover on tap, running items first with the right times", () => {
    const { store } = build();
    store.replace([done("d-2", 12 * 60_000), running("d-1", 4 * 60_000)]);

    chipButton().click();

    expect(listEl().hidden).toBe(false);
    expect(chipButton().getAttribute("aria-expanded")).toBe("true");
    const times = [...listEl().querySelectorAll<HTMLElement>(".yui-deleg__item-time")];
    expect(times.map((el) => el.textContent)).toEqual(["4분", "끝남 · 12분 전"]);
  });

  it("closes the list popover on a second tap", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);

    chipButton().click();
    chipButton().click();
    expect(chipButton().getAttribute("aria-expanded")).toBe("false");

    settle();
    expect(listEl().hidden).toBe(true);
  });

  it("closes the open list popover on Escape", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);

    chipButton().click();
    expect(listEl().hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(chipButton().getAttribute("aria-expanded")).toBe("false");
    settle();
    expect(listEl().hidden).toBe(true);
  });

  it("re-renders the open list when the store changes", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);
    chipButton().click();

    store.replace([running("d-2", 2 * 60_000), running("d-1", 60_000)]);

    const titles = [...listEl().querySelectorAll<HTMLElement>(".yui-deleg__item-title")];
    expect(titles.map((el) => el.textContent)).toEqual(["work d-2", "work d-1"]);
  });

  it("refreshes the visible times once a minute", () => {
    const { store } = build();
    store.replace([running("d-1", 4 * 60_000)]);
    chipButton().click();
    expect(listEl().querySelector<HTMLElement>(".yui-deleg__item-time")!.textContent).toBe("4분");

    clock = NOW + 60_000;
    vi.advanceTimersByTime(60_000);

    expect(listEl().querySelector<HTMLElement>(".yui-deleg__item-time")!.textContent).toBe("5분");
  });

  it("hides again when the last running item leaves", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);

    store.replace([done("d-1", 60_000)]);

    settle();
    expect(chipEl().hidden).toBe(true);
    expect(listEl().hidden).toBe(true);
  });

  it("folds to the dot on a 500ms long-press and persists the choice", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);

    press("down");
    vi.advanceTimersByTime(499);
    expect(chipEl().classList.contains("is-mini")).toBe(false);
    vi.advanceTimersByTime(1);
    press("up");

    expect(chipEl().classList.contains("is-mini")).toBe(true);
    expect(
      createDelegationChipSettings({
        storage: localStorageDelegationChipStorage(STORAGE_KEY),
      }).get().collapsed,
    ).toBe(true);
  });

  it("ignores a press released before 500ms", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);

    press("down");
    vi.advanceTimersByTime(499);
    press("up");
    vi.advanceTimersByTime(1);

    expect(chipEl().classList.contains("is-mini")).toBe(false);
  });

  it("does not fold when a long-press is interrupted by pointercancel", () => {
    const { store, collapsed } = build();
    store.replace([running("d-1", 60_000)]);

    press("down");
    chipButton().dispatchEvent(new PointerEvent("pointercancel"));
    vi.advanceTimersByTime(600);

    expect(chipEl().classList.contains("is-mini")).toBe(false);
    expect(collapsed.get().collapsed).toBe(false);
  });

  it("does not fold when a long-press is interrupted by pointerleave", () => {
    const { store, collapsed } = build();
    store.replace([running("d-1", 60_000)]);

    press("down");
    chipButton().dispatchEvent(new PointerEvent("pointerleave"));
    vi.advanceTimersByTime(600);

    expect(chipEl().classList.contains("is-mini")).toBe(false);
    expect(collapsed.get().collapsed).toBe(false);
  });

  it("expands again on a tap of the folded chip", () => {
    const { store, collapsed } = build();
    collapsed.setCollapsed(true);
    store.replace([running("d-1", 60_000)]);
    expect(chipEl().classList.contains("is-mini")).toBe(true);

    chipButton().click();

    expect(chipEl().classList.contains("is-mini")).toBe(false);
    expect(collapsed.get().collapsed).toBe(false);
    // Expanding only unfolds — the list waits for its own tap.
    expect(listEl().hidden).toBe(true);
  });

  it("does not toggle the list with the tap that follows a long-press", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);

    press("down");
    vi.advanceTimersByTime(500);
    press("up");
    chipButton().click();

    expect(listEl().hidden).toBe(true);
  });

  it("closes an open list when it folds", () => {
    const { store } = build();
    store.replace([running("d-1", 60_000)]);
    chipButton().click();
    expect(listEl().hidden).toBe(false);

    press("down");
    vi.advanceTimersByTime(500);
    press("up");

    settle();
    expect(listEl().hidden).toBe(true);
  });

  it("cancels the list's pending fade-out on dispose, so a later tick can't flip its hidden state", () => {
    const { store, chip } = build();
    store.replace([running("d-1", 60_000)]);
    chipButton().click();
    const list = listEl();
    chipButton().click();
    expect(list.hidden).toBe(false);

    chip.dispose();

    expect(() => settle()).not.toThrow();
    expect(list.hidden).toBe(false);
  });

  it("cancels the chip's own pending fade-out on dispose, so a later tick can't flip its hidden state", () => {
    const { store, chip } = build();
    store.replace([running("d-1", 60_000)]);
    const el = chip.el;
    store.replace([]);
    expect(el.hidden).toBe(false);

    chip.dispose();

    expect(() => settle()).not.toThrow();
    expect(el.hidden).toBe(false);
  });

  // The pet window is click-through passthrough; the window-level hit test only grants OS
  // clicks to rects collected from INTERACTIVE_OVERLAY_SELECTORS. Without a registered
  // selector the DOM handlers never fire, so the chip is two dead changes.
  describe("hit-test registration", () => {
    function matchAny(): Element | null {
      for (const selector of INTERACTIVE_OVERLAY_SELECTORS) {
        const el = mount.querySelector(selector);
        if (el) return el;
      }
      return null;
    }

    it("matches while the chip is visible", () => {
      const { store } = build();
      store.replace([running("d-1", 60_000)]);

      expect(matchAny()).toBe(chipButton());
    });

    it("matches the open list too", () => {
      const { store } = build();
      store.replace([running("d-1", 60_000)]);
      chipButton().click();

      const selectors = INTERACTIVE_OVERLAY_SELECTORS.map((s) => mount.querySelector(s));
      expect(selectors).toContain(listEl());
    });

    it("matches nothing while hidden", () => {
      build();
      expect(matchAny()).toBeNull();
    });
  });

  it("stops listening after dispose", () => {
    const { store, chip } = build();
    store.replace([running("d-1", 60_000)]);
    const before = chip.el.outerHTML;

    chip.dispose();
    store.replace([running("d-2", 60_000), running("d-3", 60_000)]);

    expect(chip.el.outerHTML).toBe(before);
  });
});
