// @vitest-environment jsdom
/**
 * delegation-chip.test.ts — the chip over the delegations store and the push socket state:
 * hidden at zero running, count text, the lost-connection pill while the transport is meant to
 * be up but isn't, nothing drawn while disconnected, tap-to-toggle list, the 500ms long-press
 * fold and its per-device persistence, the suppression that keeps the character window bare
 * while the surfaces are popped out, and the hit-test registration that lets OS clicks reach it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./delegation-chip.css", () => ({}));

import { INTERACTIVE_OVERLAY_SELECTORS } from "../../app/stage/wire-stage";
import { createDelegationsStore } from "../../io/bridge/delegations-store";
import type { DelegationItem, PushSocketState } from "../../io/chat/push-socket";
import {
  createDelegationChipSettings,
  localStorageDelegationChipStorage,
} from "../../io/settings/delegation-chip-settings";
import { setLocale, t } from "../i18n";
import { createDelegationChip } from "./delegation-chip";

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

  /** Stands in for the socket, so a test can move it through its states. */
  function fakePushState(initial: PushSocketState = { kind: "ready", chat_id: "yui-3f9a2c1d" }) {
    let state = initial;
    const subs = new Set<(s: PushSocketState) => void>();
    return {
      getState: () => state,
      onState(cb: (s: PushSocketState) => void) {
        subs.add(cb);
        return () => {
          subs.delete(cb);
        };
      },
      set(next: PushSocketState): void {
        state = next;
        for (const cb of subs) cb(next);
      },
      listenerCount: () => subs.size,
    };
  }

  function build(
    storage = localStorageDelegationChipStorage(STORAGE_KEY),
    pushState = fakePushState(),
  ) {
    const store = createDelegationsStore({ now: () => clock });
    const collapsed = createDelegationChipSettings({ storage });
    const onOpenSettings = vi.fn();
    const chip = createDelegationChip({
      mount,
      store,
      collapsed,
      pushState,
      onOpenSettings,
      now: () => clock,
    });
    return { store, collapsed, chip, pushState, onOpenSettings };
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
      t("deleg.chip_running_one"),
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

  it("uses the singular form in English at n=1 and the plural form at n=2", () => {
    const { store } = build();
    setLocale("en");
    store.replace([running("d-1", 60_000)]);
    expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe(
      "1 task in progress",
    );
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

  // One wording for every loss while the transport is meant to be up — the cause belongs to
  // the settings window.
  describe("lost connection", () => {
    const lost: PushSocketState[] = [
      { kind: "connecting" },
      { kind: "reconnecting", delay_ms: 4_000 },
      { kind: "failed", code: 4401 },
    ];

    for (const state of lost) {
      it(`shows the lost pill while the socket is ${state.kind}`, () => {
        build(localStorageDelegationChipStorage(STORAGE_KEY), fakePushState(state));

        expect(chipEl().hidden).toBe(false);
        expect(chipEl().classList.contains("is-lost")).toBe(true);
        expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe(
          t("deleg.chip_lost"),
        );
      });
    }

    it("words the lost pill in the active locale", () => {
      build(localStorageDelegationChipStorage(STORAGE_KEY), fakePushState({ kind: "connecting" }));

      expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe("연결 끊김");
    });

    it("shows the lost pill over the running count", () => {
      const { store, pushState } = build();
      store.replace([running("d-1", 60_000), running("d-2", 60_000)]);

      pushState.set({ kind: "reconnecting", delay_ms: 1_000 });

      expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe(
        t("deleg.chip_lost"),
      );
    });

    it("closes the open list when the connection goes", () => {
      const { store, pushState } = build();
      store.replace([running("d-1", 60_000)]);
      chipButton().click();
      expect(listEl().hidden).toBe(false);

      pushState.set({ kind: "reconnecting", delay_ms: 1_000 });

      settle();
      expect(listEl().hidden).toBe(true);
    });

    it("opens the settings window on a tap, instead of the list", () => {
      const { store, onOpenSettings } = build(
        localStorageDelegationChipStorage(STORAGE_KEY),
        fakePushState({ kind: "failed", code: 4401 }),
      );
      store.replace([running("d-1", 60_000)]);

      chipButton().click();

      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      expect(listEl().hidden).toBe(true);
    });

    it("claims no expandable list while it is lost", () => {
      build(localStorageDelegationChipStorage(STORAGE_KEY), fakePushState({ kind: "connecting" }));

      expect(chipButton().hasAttribute("aria-expanded")).toBe(false);
    });

    it("folds to the dot on a long-press, with no count badge", () => {
      const { store } = build(
        localStorageDelegationChipStorage(STORAGE_KEY),
        fakePushState({ kind: "connecting" }),
      );
      store.replace([running("d-1", 60_000), running("d-2", 60_000)]);

      press("down");
      vi.advanceTimersByTime(500);
      press("up");

      expect(chipEl().classList.contains("is-mini")).toBe(true);
      expect(mount.querySelector<HTMLElement>(".yui-deleg__count")!.textContent).toBe("");
    });

    it("returns to the running chip on the next ready", () => {
      const { store, pushState } = build(
        localStorageDelegationChipStorage(STORAGE_KEY),
        fakePushState({ kind: "connecting" }),
      );
      store.replace([running("d-1", 60_000)]);

      pushState.set({ kind: "ready", chat_id: "yui-3f9a2c1d" });

      expect(chipEl().classList.contains("is-lost")).toBe(false);
      expect(mount.querySelector<HTMLElement>(".yui-deleg__label")!.textContent).toBe(
        t("deleg.chip_running_one"),
      );
    });

    it("keeps refreshing the elapsed times after the connection comes back", () => {
      const { store, pushState } = build();
      store.replace([running("d-1", 4 * 60_000)]);
      pushState.set({ kind: "reconnecting", delay_ms: 1_000 });
      pushState.set({ kind: "ready", chat_id: "yui-3f9a2c1d" });
      chipButton().click();
      expect(listEl().querySelector<HTMLElement>(".yui-deleg__item-time")!.textContent).toBe("4분");

      clock = NOW + 60_000;
      vi.advanceTimersByTime(60_000);

      expect(listEl().querySelector<HTMLElement>(".yui-deleg__item-time")!.textContent).toBe("5분");
    });

    it("hides on a ready with nothing running", () => {
      const { pushState } = build(
        localStorageDelegationChipStorage(STORAGE_KEY),
        fakePushState({ kind: "connecting" }),
      );
      expect(chipEl().hidden).toBe(false);

      pushState.set({ kind: "ready", chat_id: "yui-3f9a2c1d" });

      settle();
      expect(chipEl().hidden).toBe(true);
    });

    it("drops its socket subscription on dispose", () => {
      const { chip, pushState } = build();
      chip.dispose();

      expect(pushState.listenerCount()).toBe(0);
    });
  });

  // disconnected means no transport is in use — nothing was asked to be up, so nothing is lost.
  it("hides and closes the list once disconnected, with running work still in the store", () => {
    const { store, pushState } = build();
    store.replace([running("d-1", 60_000)]);
    chipButton().click();
    expect(chipEl().hidden).toBe(false);
    expect(listEl().hidden).toBe(false);

    pushState.set({ kind: "disconnected" });

    settle();
    expect(chipEl().hidden).toBe(true);
    expect(listEl().hidden).toBe(true);
    expect(chipEl().classList.contains("is-lost")).toBe(false);
  });

  it("drops the lost pill once disconnected", () => {
    const { pushState } = build(
      localStorageDelegationChipStorage(STORAGE_KEY),
      fakePushState({ kind: "reconnecting", delay_ms: 1_000 }),
    );
    expect(chipEl().classList.contains("is-lost")).toBe(true);

    pushState.set({ kind: "disconnected" });

    settle();
    expect(chipEl().hidden).toBe(true);
    expect(chipEl().classList.contains("is-lost")).toBe(false);
  });

  // The surfaces popped out take the chip with them; the character window shows none.
  describe("suppressed", () => {
    it("hides a running chip", () => {
      const { store, chip } = build();
      store.replace([running("d-1", 60_000)]);

      chip.setSuppressed(true);

      settle();
      expect(chipEl().hidden).toBe(true);
    });

    it("hides the lost pill too", () => {
      const { chip } = build(
        localStorageDelegationChipStorage(STORAGE_KEY),
        fakePushState({ kind: "connecting" }),
      );
      expect(chipEl().hidden).toBe(false);

      chip.setSuppressed(true);

      settle();
      expect(chipEl().hidden).toBe(true);
    });

    it("stays hidden while work arrives", () => {
      const { store, chip } = build();
      chip.setSuppressed(true);

      store.replace([running("d-1", 60_000)]);

      expect(chipEl().hidden).toBe(true);
    });

    it("comes back when the surfaces dock again", () => {
      const { store, chip } = build();
      store.replace([running("d-1", 60_000)]);
      chip.setSuppressed(true);
      settle();

      chip.setSuppressed(false);

      expect(chipEl().hidden).toBe(false);
    });
  });

  // The message window closes the list when the reasoning chip's panel opens.
  describe("closeList / onListOpen", () => {
    it("closeList() closes an open list", () => {
      const { store, chip } = build();
      store.replace([running("d-1", 60_000)]);
      chipButton().click();
      expect(listEl().hidden).toBe(false);

      chip.closeList();

      expect(chipButton().getAttribute("aria-expanded")).toBe("false");
      settle();
      expect(listEl().hidden).toBe(true);
    });

    it("closeList() on an already closed list is a no-op", () => {
      const { store, chip } = build();
      store.replace([running("d-1", 60_000)]);

      expect(() => chip.closeList()).not.toThrow();
      expect(chipButton().getAttribute("aria-expanded")).toBe("false");
      expect(listEl().hidden).toBe(true);
    });

    it("onListOpen fires once per closed → open transition and stops on unsubscribe", () => {
      const { store, chip } = build();
      store.replace([running("d-1", 60_000)]);
      const onOpen = vi.fn();
      const off = chip.onListOpen(onOpen);

      chipButton().click();
      expect(onOpen).toHaveBeenCalledTimes(1);
      chipButton().click();
      settle();
      chipButton().click();
      expect(onOpen).toHaveBeenCalledTimes(2);

      off();
      chipButton().click();
      settle();
      chipButton().click();
      expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it("fires onListOpen no more after dispose", () => {
      const { store, chip } = build();
      store.replace([running("d-1", 60_000)]);
      const onOpen = vi.fn();
      chip.onListOpen(onOpen);
      const btn = chipButton();

      chip.dispose();
      expect(() => btn.click()).not.toThrow();

      expect(onOpen).not.toHaveBeenCalled();
    });
  });
});
