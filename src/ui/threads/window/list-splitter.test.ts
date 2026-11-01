// @vitest-environment jsdom
/** list-splitter.test.ts — the wide list's edge drags and steps the list width within its range, saves it, and resets it. */

import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { createListSplitter } from "./list-splitter";

const VAR = "--yui-threads-list-width";

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

/** A panel `panelWidth` px wide whose panes start at x 8 and whose list shows the width the variable sets, else 299. */
function build(panelWidth: number, stored: number | null = null) {
  const panel = document.createElement("section");
  Object.defineProperty(panel, "clientWidth", { value: panelWidth });
  const panes = document.createElement("div");
  const list = document.createElement("nav");
  list.className = "yui-threads-list";
  panes.append(list);
  panel.append(panes);
  document.body.append(panel);
  const shown = () => Number.parseFloat(panel.style.getPropertyValue(VAR)) || 299;
  panes.getBoundingClientRect = () => ({ left: 8 }) as DOMRect;
  list.getBoundingClientRect = () => ({ width: shown() }) as DOMRect;
  const onWidth = vi.fn();
  const splitter = createListSplitter({ panel, width: stored, onWidth });
  const edge = splitter.separator();
  panes.append(edge);
  const drag = (...xs: number[]) => {
    edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 307 }));
    for (const clientX of xs) {
      edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX }));
    }
    edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
  };
  const key = (key: string) => edge.dispatchEvent(new KeyboardEvent("keydown", { key }));
  const width = () => panel.style.getPropertyValue(VAR);
  return { edge, drag, key, width, onWidth };
}

it.each([
  ["a width inside the range", 880, 408, "400px", 400],
  ["at least 220px", 880, 100, "220px", 220],
  ["at most half the panel", 880, 900, "440px", 440],
  ["at most 480px", 1100, 1000, "480px", 480],
])("drags the list to %s and saves it on release", (_name, panelWidth, x, width, saved) => {
  const t = build(panelWidth);

  t.drag(350, x);

  expect(t.width()).toBe(width);
  expect(t.onWidth.mock.calls).toEqual([[saved]]);
});

it("steps the shown width by 16px with the arrow keys and saves each step", () => {
  const t = build(880);

  t.key("ArrowRight");
  t.key("ArrowLeft");
  t.key("ArrowLeft");

  expect(t.width()).toBe("283px");
  expect(t.onWidth.mock.calls).toEqual([[315], [299], [283]]);
});

it("goes back to the default width on a double-click", () => {
  const t = build(880, 312);
  expect(t.width()).toBe("312px");

  t.edge.dispatchEvent(new MouseEvent("dblclick"));

  expect(t.width()).toBe("");
  expect(t.onWidth.mock.calls).toEqual([[null]]);
});

it("is a labelled vertical window splitter reporting the shown width and its range", () => {
  const t = build(880, 312);

  expect(t.edge.getAttribute("role")).toBe("separator");
  expect(t.edge.tabIndex).toBe(0);
  expect(
    ["aria-orientation", "aria-label", "aria-valuenow", "aria-valuemin", "aria-valuemax"].map(
      (name) => t.edge.getAttribute(name),
    ),
  ).toEqual(["vertical", "List width", "312", "220", "440"]);
});
