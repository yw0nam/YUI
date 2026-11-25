// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { attachChipColumn, planColumn } from "./chip-column";

const row = (top: number, bottom: number, count = 1, urgent = false) => ({
  top,
  bottom,
  urgent,
  count,
});

describe("planColumn", () => {
  it.each([
    [
      "everything fits: nothing moves",
      { rows: [row(180, 208), row(214, 242)], top: 180, limit: 300 },
      { shift: 0, hide: [], folded: 0 },
    ],
    [
      "moved up, the column ends at the limit with every row",
      { rows: [row(70, 98), row(104, 132), row(138, 156)], top: 70, limit: 100 },
      { shift: 56, hide: [], folded: 0 },
    ],
    [
      "clamped at the edge, the rows that still do not fit fold with their counts summed",
      {
        rows: [row(40, 68, 1, true), row(74, 102, 3), row(108, 136, 2), row(142, 170, 1)],
        top: 40,
        limit: 120,
      },
      { shift: 32, hide: [2, 3], folded: 3 },
    ],
    [
      "urgent rows fit but leave no room for the fold row: every other row hides and no fold row shows",
      {
        rows: [row(40, 68, 1, true), row(74, 102, 1, true), row(108, 136, 2)],
        top: 40,
        limit: 90,
      },
      { shift: 32, hide: [2], folded: 0 },
    ],
    [
      "urgent rows alone pass the limit: every other row hides and no fold row shows",
      {
        rows: [
          row(40, 68, 1, true),
          row(74, 102, 1, true),
          row(108, 136, 1, true),
          row(142, 170, 2),
        ],
        top: 40,
        limit: 60,
      },
      { shift: 32, hide: [3], folded: 0 },
    ],
  ])("%s", (_name, input, plan) => {
    expect(planColumn({ ...input, edge: 8, gap: 6, foldRowHeight: 28 })).toEqual(plan);
  });
});

describe("attachChipColumn", () => {
  // Boxes in the overlay's coordinates; jsdom lays nothing out.
  const boxes = new Map<HTMLElement, [top: number, height: number]>();
  let frames: FrameRequestCallback[];
  let root: HTMLElement;
  let column: HTMLElement;
  let bubble: HTMLElement;
  let askSlot: HTMLElement;
  let card: HTMLElement;
  let rows: HTMLElement[];

  const el = (className: string, parent: HTMLElement): HTMLElement => {
    const made = document.createElement("div");
    made.className = className;
    parent.append(made);
    return made;
  };

  beforeEach(() => {
    setLocale("en");
    frames = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const [top, height] = this.classList.contains("yui-chip-column__fold")
        ? [0, 28]
        : (boxes.get(this) ?? [0, 0]);
      return { top, bottom: top + height, height } as DOMRect;
    });
    root = el("yui-ui", document.body);
    bubble = el("yui-bubble", root);
    column = el("yui-chip-column", root);
    column.style.rowGap = "6px";
    askSlot = el("yui-ask-slot", root);
    card = el("yui-ask-card", askSlot);
    card.hidden = true;
  });

  afterEach(() => {
    boxes.clear();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function layout(columnTop: number, rowBoxes: [top: number, height: number, count?: number][]) {
    boxes.set(column, [columnTop, 0]);
    column.style.top = `${columnTop}px`;
    rows = rowBoxes.map(([top, height, count = 1]) => {
      const made = el("row", column);
      made.dataset.chipCount = String(count);
      boxes.set(made, [top, height]);
      return made;
    });
  }

  async function settle(): Promise<void> {
    await Promise.resolve();
    for (const cb of frames.splice(0)) cb(0);
    await Promise.resolve();
  }

  it("an Ask card over a shown bubble leads, and with both gone the column returns", async () => {
    layout(180, [
      [180, 28],
      [214, 28],
      [248, 28],
    ]);
    attachChipColumn(root);
    bubble.style.top = "250px";
    boxes.set(card, [200, 120]);

    bubble.classList.add("is-visible");
    card.hidden = false;
    await settle();
    const both = column.style.transform;
    card.hidden = true;
    bubble.classList.remove("is-visible");
    await settle();

    expect([both, column.style.transform]).toEqual(["translateY(-84px)", ""]);
  });

  it("a bubble that has stepped aside is no obstacle", async () => {
    layout(180, [
      [180, 28],
      [214, 28],
      [248, 28],
    ]);
    attachChipColumn(root);
    bubble.style.top = "250px";

    bubble.classList.add("is-visible");
    bubble.style.visibility = "hidden";
    await settle();
    const aside = column.style.transform;
    bubble.style.visibility = "";
    await settle();

    expect([aside, column.style.transform]).toEqual(["", "translateY(-34px)"]);
  });

  it("folds the rows that still do not fit into one +N row, and dispose removes everything", async () => {
    layout(40, [
      [40, 28],
      [74, 28, 3],
      [108, 28, 2],
      [142, 28, 1],
    ]);
    rows[0]!.toggleAttribute("data-chip-urgent", true);
    const detach = attachChipColumn(root);
    boxes.set(card, [128, 120]);

    card.hidden = false;
    await settle();

    const fold = column.querySelector<HTMLElement>(".yui-chip-column__fold");
    expect({
      transform: column.style.transform,
      capped: rows.map((r) => r.classList.contains("is-capped")),
      fold: [fold?.textContent, column.lastElementChild === fold],
      pending: frames.length,
    }).toEqual({
      transform: "translateY(-32px)",
      capped: [false, false, true, true],
      fold: ["+3", true],
      pending: 0,
    });

    detach();

    expect([
      column.style.transform,
      column.querySelectorAll(".is-capped, .yui-chip-column__fold").length,
    ]).toEqual(["", 0]);
  });
});
