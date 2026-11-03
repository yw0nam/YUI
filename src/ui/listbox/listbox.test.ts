// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createListbox } from "./listbox";

it("owns one open list per field and leaves another owner's attributes alone", () => {
  const field = document.createElement("textarea");
  const mount = document.createElement("div");
  const first = document.createElement("div");
  first.id = "mentions";
  const second = document.createElement("div");
  second.id = "commands";
  mount.append(first, second);
  const a = createListbox({ field, root: first, onPick() {} });
  const b = createListbox({ field, root: second, onPick() {} });
  const option = document.createElement("div");
  option.id = "status";
  a.set([{ id: "a", el: document.createElement("div") }]);
  a.open();
  b.set([{ id: "status", el: option }]);
  b.open();
  b.activate(0);
  expect(first.hidden).toBe(true);
  expect(field.getAttribute("aria-controls")).toBe("commands");
  a.close();
  a.dispose();
  expect(field.getAttribute("aria-expanded")).toBe("true");
  expect(field.getAttribute("aria-activedescendant")).toBe("status");
  b.dispose();
  expect(field.hasAttribute("role")).toBe(false);
});
