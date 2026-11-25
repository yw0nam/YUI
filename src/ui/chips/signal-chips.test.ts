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
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
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
    vi.unstubAllGlobals();
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
  const srcOf = (chip: HTMLElement) => chip.querySelector(".yui-sigchip__src")!.textContent;
  const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const press = (el: Element, type: "pointerdown" | "pointerup") =>
    el.dispatchEvent(new Event(type, { bubbles: true }));

  it("urgent chips keep a row each and the batched ones share one +N row that expands in place", () => {
    build([
      group(1),
      group(2),
      group(3),
      group(4, { delivery: "urgent" }),
      group(5, { delivery: "urgent" }),
    ]);

    expect(chipEls().map(srcOf)).toEqual(["src5", "src4", "src3"]);
    expect(chipEls().map((c) => [c.dataset.chipCount, c.hasAttribute("data-chip-urgent")])).toEqual(
      [
        ["1", true],
        ["1", true],
        ["3", false],
      ],
    );
    const grouped = chipEls()[2]!;
    const more = grouped.querySelector<HTMLButtonElement>(".yui-sigchip__more")!;
    expect(more.textContent).toBe("+2");
    expect(more.getAttribute("aria-label")).toBe("Show 2 more signals");
    expect(opener(2).getAttribute("aria-label")).toBe(
      "Batched signal from src3: label 3. Show 2 more signals",
    );
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(grouped.querySelector<HTMLButtonElement>(".yui-sigchip__x")!.hidden).toBe(true);

    click(more);

    const region = mount.querySelector<HTMLElement>(".yui-sigchips__batched")!;
    expect([...region.querySelectorAll<HTMLElement>(".yui-sigchip")].map(srcOf)).toEqual([
      "src3",
      "src2",
      "src1",
    ]);
    expect(region.dataset.chipCount).toBe("3");
    expect(opener(2).getAttribute("aria-label")).toBe("Batched signal from src3: label 3");
    expect(region.querySelectorAll("[data-chip-count]")).toHaveLength(0);
    expect(region.lastElementChild).toBe(more);
    expect(more.textContent).toBe("Collapse");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(opener(3));

    click(more);

    expect(chipEls().map(srcOf)).toEqual(["src5", "src4", "src3"]);
    expect(more.textContent).toBe("+2");
    expect(document.activeElement).toBe(more);
  });

  it("every urgent chip shows outside the scroll region, ten of them included", () => {
    build([
      group(1),
      group(2),
      ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => group(n, { delivery: "urgent" })),
    ]);
    click(mount.querySelector(".yui-sigchip__more")!);

    const root = mount.querySelector(".yui-sigchips")!;
    expect(root.querySelectorAll(":scope > .yui-sigchip--urgent")).toHaveLength(10);
    expect(
      [...mount.querySelectorAll<HTMLElement>(".yui-sigchips__batched .yui-sigchip")].map(srcOf),
    ).toEqual(["src2", "src1"]);
  });

  it("the chip shows the event type when the group has no label, and the urgent class", () => {
    build([group(1, { label: undefined, delivery: "urgent" })]);

    expect(chipEls()[0]!.classList.contains("yui-sigchip--urgent")).toBe(true);
    expect(chipEls()[0]!.querySelector(".yui-sigchip__text")!.textContent).toBe("ci.failed");
  });

  it("the cross dismisses its chip", () => {
    const { model } = build([group(1), group(2, { delivery: "urgent" })]);

    click(chipEls()[0]!.querySelector(".yui-sigchip__x")!);

    expect(chipEls()).toHaveLength(1);
    expect(model.list().map((i) => i.group.envelope.event_id)).toEqual(["e1"]);
  });

  it("Dismiss in the last chip's details closes the sheet at once", () => {
    build([group(1)]);
    click(opener(0));

    click(mount.querySelector(".yui-sigdetails__dismiss")!);

    expect(mount.querySelector(".yui-sigdetails")).toBeNull();
  });

  it("a tap opens the details with what YUI said and the raw items; Escape closes it", () => {
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

    const sheet = mount.querySelector(".yui-sigdetails")!;
    expect(opener(0).getAttribute("aria-expanded")).toBe("true");
    expect(sheet.querySelector(".yui-sigdetails__said")!.textContent).toBe(
      "\u201CThe build broke.\u201D",
    );
    expect(sheet.querySelector(".yui-sigdetails__items")!.textContent).toBe(
      '[\n {\n  "run": 1\n }\n]',
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(mount.querySelector(".yui-sigdetails")).toBeNull();
    expect(opener(0).getAttribute("aria-expanded")).toBe("false");
  });

  it("the details say Did not speak while nothing was said, and shows one sheet at a time", () => {
    build([group(1), group(2, { delivery: "urgent" })]);

    click(opener(0));
    expect(mount.querySelector(".yui-sigdetails__said")!.textContent).toBe("Did not speak");

    click(opener(1));
    expect(mount.querySelectorAll(".yui-sigdetails")).toHaveLength(1);
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
    expect(mount.querySelector(".yui-sigdetails")).toBeNull();
  });

  it("a shorter press opens the details instead of folding", () => {
    const { collapsed } = build([group(1)]);

    press(opener(0), "pointerdown");
    vi.advanceTimersByTime(499);
    press(opener(0), "pointerup");
    click(opener(0));

    expect(collapsed.get().collapsed).toBe(false);
    expect(mount.querySelector(".yui-sigdetails__said")!.textContent).toBe("Did not speak");
  });

  it("follows the shared fold store from outside, and a click while folded unfolds", () => {
    const { collapsed } = build([group(1)]);

    collapsed.setCollapsed(true);
    expect(mount.querySelector(".yui-sigchips")!.classList.contains("is-mini")).toBe(true);

    click(opener(0));
    expect(collapsed.get().collapsed).toBe(false);
    expect(mount.querySelector(".yui-sigchips")!.classList.contains("is-mini")).toBe(false);
    expect(mount.querySelector(".yui-sigdetails")).toBeNull();
  });

  it("a history update and a new signal keep each chip's element, so focus and the pulse survive", () => {
    const { model } = build([group(1), group(2), group(3, { delivery: "urgent" })]);
    const [urgent, grouped] = chipEls();
    opener(1).focus();

    history.rows = [
      {
        turn_id: "t1",
        event_id: "e2",
        source: "src2",
        event_type: "ci.failed",
        label: "label 2",
        delivery: "batched",
        ts: 1,
        said: "Seen.",
      },
    ];
    for (const cb of history.subs) cb();
    model.add(group(4, { delivery: "urgent" }));

    expect(chipEls().map(srcOf)).toEqual(["src4", "src3", "src2"]);
    expect([chipEls()[1]!.isSameNode(urgent!), chipEls()[2]!.isSameNode(grouped!)]).toEqual([
      true,
      true,
    ]);
    expect(document.activeElement).toBe(grouped!.querySelector(".yui-sigchip__open"));
  });

  it("a second batched signal turns the single chip into the grouped row, urgent chips untouched", () => {
    const { model } = build([group(1, { delivery: "urgent" }), group(2)]);
    const urgent = chipEls()[0]!;
    expect(chipEls()[1]!.dataset.chipCount).toBe("1");
    expect(chipEls()[1]!.querySelector(".yui-sigchip__more")).toBeNull();

    model.add(group(3));

    expect(chipEls().map(srcOf)).toEqual(["src1", "src3"]);
    expect(chipEls()[0]!.isSameNode(urgent)).toBe(true);
    expect(chipEls()[1]!.dataset.chipCount).toBe("2");
    expect(chipEls()[1]!.querySelector(".yui-sigchip__more")!.textContent).toBe("+1");
  });

  it("the details take focus on the close button and give it back to the chip without scrolling", () => {
    build([group(1)]);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    click(opener(0));
    expect(document.activeElement).toBe(mount.querySelector(".yui-sigdetails__close"));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });

    focus.mockClear();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(opener(0));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });
});
