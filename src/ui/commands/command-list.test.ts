// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { createCommandList } from "./command-list";

const commands = [
  { name: "status", description: "Session info", args: "" },
  { name: "model", description: "Switch model", args: "[name]" },
];
let field: HTMLTextAreaElement;
let mount: HTMLElement;
let list: ReturnType<typeof createCommandList>;
function type(text: string) {
  field.value = text;
  field.dispatchEvent(new Event("input"));
}
function key(key: string, extra: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  field.dispatchEvent(e);
  return e;
}
beforeEach(() => {
  setLocale("en");
  mount = document.createElement("div");
  field = document.createElement("textarea");
  mount.append(field);
  document.body.append(mount);
  list = createCommandList({ field, mount, commands: () => commands });
});
afterEach(() => {
  list.dispose();
  mount.remove();
});
it("opens on / and filters by name prefix", () => {
  type("/");
  expect(field.getAttribute("aria-expanded")).toBe("true");
  expect(mount.querySelectorAll('[role="option"]')).toHaveLength(2);
  type("/mo");
  expect(mount.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(mount.textContent).toContain("Switch model");
  expect(mount.textContent).toContain("/model [name]");
});
it("completes a partial name with Tab", () => {
  type("/sta");
  expect(key("Tab").defaultPrevented).toBe(true);
  expect(field.value).toBe("/status ");
  expect(field.getAttribute("aria-expanded")).toBe("false");
});
it("leaves Enter on a full name to submit", () => {
  type("/status");
  expect(key("Enter").defaultPrevented).toBe(false);
});
it("closes on Escape before the input handles it", () => {
  const inputKey = vi.fn();
  field.addEventListener("keydown", inputKey);
  type("/");
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(inputKey).not.toHaveBeenCalled();
  expect(field.getAttribute("aria-expanded")).toBe("false");
});
it("leaves Shift+Enter unconsumed", () => {
  type("/sta");
  expect(key("Enter", { shiftKey: true }).defaultPrevented).toBe(false);
  expect(field.value).toBe("/sta");
});
it("shows no list without commands", () => {
  list.dispose();
  list = createCommandList({ field, mount, commands: () => [] });
  type("/");
  expect(field.getAttribute("aria-expanded")).toBe("false");
});

it("wraps descriptions without ellipsis", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(resolve(__dirname, "command-list.css"), "utf8");
  document.head.append(style);
  try {
    type("/");
    const description = mount.querySelector<HTMLElement>(".yui-cmd-list__description")!;
    expect(getComputedStyle(description).textOverflow).not.toBe("ellipsis");
    expect(getComputedStyle(description).whiteSpace).not.toBe("nowrap");
  } finally {
    style.remove();
  }
});
it.each([
  [0, "/status ", 40],
  [20, "/", 60],
])("a %i px press-release picks only without a drag", (distance, text, scrollTop) => {
  field.focus();
  type("/");
  const rows = mount.querySelector<HTMLElement>(".yui-cmd-list__rows")!;
  Object.defineProperties(rows, {
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: () => true },
    scrollHeight: { value: 500 },
    clientHeight: { value: 100 },
  });
  rows.scrollTop = 40;
  const stageDown = vi.fn();
  mount.addEventListener("pointerdown", stageDown);
  const row = rows.firstElementChild!;
  const pointer = (type: string, clientY: number) =>
    row.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: 20,
        clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
  pointer("pointerdown", 100);
  expect(field.value).toBe("/");
  pointer("pointermove", 100 - distance);
  pointer("pointerup", 100 - distance);
  expect(field.value).toBe(text);
  expect(rows.scrollTop).toBe(scrollTop);
  expect(document.activeElement).toBe(field);
  expect(stageDown).not.toHaveBeenCalled();
});
