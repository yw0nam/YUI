// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./signal-chips.css", () => ({}));

import type { SignalEnvelope, SignalGroup } from "../../contract";
import type { SignalRecord } from "../../io/chat/conversation/signal-history-store";
import { createDelegationChipSettings } from "../../settings/panels/delegation-chip-settings";
import { setLocale } from "../i18n";
import { createSignalChips } from "./signal-chips";
import { createSignalChipsModel } from "./signal-chips-model";

function group(n: number, over: Partial<SignalEnvelope> = {}): SignalGroup {
  return {
    envelope: {
      source: `src${n}`,
      event_type: "ci.failed",
      delivery: "batched",
      event_id: `e${n}`,
      occurred_at: 1,
      label: `label ${n}`,
      ...over,
    },
    items: [{ run: n }],
  };
}

describe("createSignalChips", () => {
  let mount: HTMLElement;
  let history: { rows: SignalRecord[]; subs: Set<() => void> };

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    history = { rows: [], subs: new Set() };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function build(groups: SignalGroup[]) {
    const model = createSignalChipsModel({
      history: {
        records: () => history.rows,
        subscribe: (cb) => {
          history.subs.add(cb);
          return () => history.subs.delete(cb);
        },
      },
    });
    const collapsed = createDelegationChipSettings();
    const chips = createSignalChips({ mount, model, collapsed });
    for (const g of groups) model.add(g);
    return { model, collapsed, chips };
  }

  const chipEls = () => [...mount.querySelectorAll<HTMLElement>(".yui-sigchip")];
  const opener = (i: number) =>
    chipEls()[i]!.querySelector<HTMLButtonElement>(".yui-sigchip__open")!;
  const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const press = (el: Element, type: "pointerdown" | "pointerup") =>
    el.dispatchEvent(new Event(type, { bubbles: true }));

  it("shows three chips and a +2 pill for five, newest first, and +2 expands in place", () => {
    build([1, 2, 3, 4, 5].map((n) => group(n)));

    expect(chipEls()).toHaveLength(3);
    expect(chipEls()[0]!.querySelector(".yui-sigchip__src")!.textContent).toBe("src5");
    expect(chipEls()[0]!.querySelector(".yui-sigchip__text")!.textContent).toBe("label 5");
    const more = mount.querySelector<HTMLButtonElement>(".yui-sigchip__more")!;
    expect(more.textContent).toBe("+2");

    click(more);

    expect(chipEls()).toHaveLength(5);
    expect(mount.querySelector(".yui-sigchip__more")).toBeNull();
    click(mount.querySelector(".yui-sigchip__collapse")!);
    expect(chipEls()).toHaveLength(3);
  });

  it("the chip shows the event type when the group has no label, and the urgent class", () => {
    build([group(1, { label: undefined, delivery: "urgent" })]);

    expect(chipEls()[0]!.classList.contains("yui-sigchip--urgent")).toBe(true);
    expect(chipEls()[0]!.querySelector(".yui-sigchip__text")!.textContent).toBe("ci.failed");
  });

  it("the cross dismisses its chip", () => {
    const { model } = build([group(1), group(2)]);

    click(chipEls()[0]!.querySelector(".yui-sigchip__x")!);

    expect(chipEls()).toHaveLength(1);
    expect(model.list().map((i) => i.group.envelope.event_id)).toEqual(["e1"]);
  });

  it("a tap opens the card with what YUI said and the raw items; Escape closes it", () => {
    history.rows = [
      {
        turn_id: "t1",
        event_id: "e1",
        source: "src1",
        event_type: "ci.failed",
        label: "label 1",
        delivery: "batched",
        ts: 1,
        said: "The build broke.",
      },
    ];
    build([group(1)]);

    click(opener(0));

    const card = mount.querySelector(".yui-sigcard")!;
    expect(opener(0).getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector(".yui-sigcard__said")!.textContent).toContain("The build broke.");
    expect(card.querySelector(".yui-sigcard__items")!.textContent).toBe(
      JSON.stringify([{ run: 1 }], null, 1),
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(mount.querySelector(".yui-sigcard")).toBeNull();
    expect(opener(0).getAttribute("aria-expanded")).toBe("false");
  });

  it("the card says Did not speak while nothing was said, and shows one card at a time", () => {
    build([group(1), group(2)]);

    click(opener(0));
    expect(mount.querySelector(".yui-sigcard__said")!.textContent).toBe("Did not speak");

    click(opener(1));
    expect(mount.querySelectorAll(".yui-sigcard")).toHaveLength(1);
    expect(opener(0).getAttribute("aria-expanded")).toBe("false");
  });

  it("a 500 ms hold folds every chip to its dot and swallows the release click", () => {
    const { collapsed } = build([group(1)]);

    press(opener(0), "pointerdown");
    vi.advanceTimersByTime(500);
    press(opener(0), "pointerup");
    click(opener(0));

    expect(collapsed.get().collapsed).toBe(true);
    expect(mount.querySelector(".yui-sigchips")!.classList.contains("is-mini")).toBe(true);
    expect(mount.querySelector(".yui-sigcard")).toBeNull();
  });

  it("a shorter press opens the card instead of folding", () => {
    const { collapsed } = build([group(1)]);

    press(opener(0), "pointerdown");
    vi.advanceTimersByTime(499);
    press(opener(0), "pointerup");
    click(opener(0));

    expect(collapsed.get().collapsed).toBe(false);
    expect(mount.querySelector(".yui-sigcard")).not.toBeNull();
  });

  it("follows the shared fold store from outside, and a click while folded unfolds", () => {
    const { collapsed } = build([group(1)]);

    collapsed.setCollapsed(true);
    expect(mount.querySelector(".yui-sigchips")!.classList.contains("is-mini")).toBe(true);

    click(opener(0));
    expect(collapsed.get().collapsed).toBe(false);
    expect(mount.querySelector(".yui-sigchips")!.classList.contains("is-mini")).toBe(false);
    expect(mount.querySelector(".yui-sigcard")).toBeNull();
  });
});
