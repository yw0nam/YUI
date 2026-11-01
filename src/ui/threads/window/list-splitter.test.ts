// @vitest-environment jsdom
/** list-splitter.test.ts — the wide list's edge drags and steps the list width within its range, saves it, resets it, and reports it. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { createListSplitter } from "./list-splitter";

const VAR = "--yui-threads-list-width";

/** The panel's ResizeObserver callbacks; `resized` runs them. */
let observers: ResizeObserverCallback[] = [];
const resized = () => {
  for (const cb of observers) cb([], {} as ResizeObserver);
};

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  observers = [];
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push(cb);
      }
      observe() {}
      disconnect() {
        observers = observers.filter((cb) => cb !== this.cb);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

/**
 * A panel `size.panel` px wide whose panes start at x 8. The shown tab's list shows the width the
 * variable sets, else 299, unless `size.list` overrides it; the hidden tab's list shows 0.
 */
function build(size: { panel: number; list?: number }, stored: number | null = null) {
  const panel = document.createElement("section");
  Object.defineProperty(panel, "clientWidth", { get: () => size.panel });
  const shownWidth = () =>
    size.list ?? (Number.parseFloat(panel.style.getPropertyValue(VAR)) || 299);
  const tab = (id: string, width: () => number) => {
    const panes = document.createElement("div");
    const list = document.createElement("nav");
    list.id = id;
    panes.append(list);
    panel.append(panes);
    panes.getBoundingClientRect = () => ({ left: 8 }) as DOMRect;
    list.getBoundingClientRect = () => ({ width: width() }) as DOMRect;
    return list;
  };
  const lists = [tab("shown-list", shownWidth), tab("hidden-list", () => 0)];
  document.body.append(panel);
  const onWidth = vi.fn();
  const splitter = createListSplitter({ panel, width: stored, onWidth });
  for (const list of lists) splitter.attach(list);
  const [edge, hiddenEdge] = lists.map((list) => list.nextElementSibling as HTMLElement);
  const pointer = (type: string, clientX?: number) =>
    edge!.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 1, clientX }));
  const drag = (from: number, ...xs: number[]) => {
    pointer("pointerdown", from);
    for (const x of xs) pointer("pointermove", x);
    pointer("pointerup");
  };
  const key = (key: string) => edge!.dispatchEvent(new KeyboardEvent("keydown", { key }));
  const width = () => panel.style.getPropertyValue(VAR);
  const aria = (el: HTMLElement) =>
    ["aria-valuenow", "aria-valuemax"].map((name) => el.getAttribute(name));
  return {
    edge: edge!,
    hiddenEdge: hiddenEdge!,
    pointer,
    drag,
    key,
    width,
    aria,
    onWidth,
    splitter,
  };
}

it.each([
  ["a width inside the range", 880, 408, "400px", 400],
  ["at least 220px", 880, 100, "220px", 220],
  ["at most half the panel", 880, 900, "440px", 440],
  ["at most 480px", 1100, 1000, "480px", 480],
])("drags the list to %s and saves it on release", (_name, panelWidth, x, width, saved) => {
  const t = build({ panel: panelWidth });

  t.drag(307, 350, x);

  expect(t.width()).toBe(width);
  expect(t.onWidth.mock.calls).toEqual([[saved]]);
});

it("keeps the grab point under the pointer, so the list moves by the pointer's travel", () => {
  const t = build({ panel: 880 });

  // The list's edge is at 8 + 299 = 307; the grab is 3px right of it.
  t.drag(310, 410);

  expect(t.width()).toBe("399px");
});

it("ignores a second press while a drag lasts, saving once on release", () => {
  const t = build({ panel: 880 });

  t.pointer("pointerdown", 307);
  t.pointer("pointerdown", 307);
  t.pointer("pointermove", 400);
  t.pointer("pointerup");
  t.pointer("pointermove", 500);

  expect(t.width()).toBe("392px");
  expect(t.onWidth.mock.calls).toEqual([[392]]);
});

it("steps the shown width by 16px with the arrow keys and saves each step", () => {
  const t = build({ panel: 880 });

  t.key("ArrowRight");
  t.key("ArrowLeft");
  t.key("ArrowLeft");

  expect(t.width()).toBe("283px");
  expect(t.onWidth.mock.calls).toEqual([[315], [299], [283]]);
  expect(t.aria(t.edge)).toEqual(["283", "440"]);
});

it("goes back to the default width on a double-click", () => {
  const t = build({ panel: 880 }, 312);
  expect(t.width()).toBe("312px");

  t.edge.dispatchEvent(new MouseEvent("dblclick"));

  expect(t.width()).toBe("");
  expect(t.onWidth.mock.calls).toEqual([[null]]);
  expect(t.aria(t.edge)).toEqual(["299", "440"]);
});

it("is a labelled vertical window splitter controlling its tab's list", () => {
  const t = build({ panel: 880 }, 312);

  expect(t.edge.getAttribute("role")).toBe("separator");
  expect(t.edge.tabIndex).toBe(0);
  expect(
    ["aria-orientation", "aria-label", "aria-controls", "aria-valuemin"].map((name) =>
      t.edge.getAttribute(name),
    ),
  ).toEqual(["vertical", "List width", "shown-list", "220"]);
  expect(t.hiddenEdge.getAttribute("aria-controls")).toBe("hidden-list");
});

it("reports the shown list's width within the range on a panel resize, leaving the hidden tab's edge", () => {
  const size: { panel: number; list?: number } = { panel: 880 };
  const t = build(size);
  t.edge.dispatchEvent(new FocusEvent("focus"));
  expect(t.aria(t.edge)).toEqual(["299", "440"]);

  size.panel = 600;
  size.list = 304;
  resized();

  expect(t.aria(t.edge)).toEqual(["300", "300"]);
  expect(t.aria(t.hiddenEdge)).toEqual([null, null]);
});

it("names the edge in the UI language until it is disposed", () => {
  const t = build({ panel: 880 });

  setLocale("ko");
  expect(t.edge.getAttribute("aria-label")).toBe("목록 너비");

  t.splitter.dispose();
  setLocale("en");
  expect(t.edge.getAttribute("aria-label")).toBe("목록 너비");
  expect(observers).toEqual([]);
});
