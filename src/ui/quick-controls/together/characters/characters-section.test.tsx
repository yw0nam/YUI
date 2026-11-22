// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPetWindows } from "../../../../settings/preset/pet-windows";
import { createPresetRegistry } from "../../../../settings/preset/preset-registry";
import { setLocale } from "../../../i18n";
import { createTogetherPage } from "../together-page";

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const pages: ReturnType<typeof createTogetherPage>[] = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({
      active: "aaaa0001",
      list: ["aaaa0001", "bbbb0002", "cccc0003", "dddd0004", "eeee0005"].map((id, i) => ({
        id,
        name: ["natsume", "perlica", "shino", "klukai", "carlotta"][i],
      })),
    }),
  );
  setLocale("en");
});
afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
});

function build(boundId: string | null = null) {
  const registry = createPresetRegistry();
  const petWindows = createPetWindows();
  if (boundId) petWindows.open(boundId);
  const page = createTogetherPage({ rows: [], registry, petWindows, boundId, log });
  pages.push(page);
  document.body.append(page.el);
  const row = (name: string) =>
    [...page.el.querySelectorAll<HTMLElement>(".yui-chars__row")].find(
      (r) => r.querySelector(".yui-row__label")?.textContent === name,
    )!;
  const sw = (name: string) => row(name).querySelector<HTMLButtonElement>(".yui-switch")!;
  const meta = (name: string) => row(name).querySelector(".yui-chars__meta")!.textContent;
  const count = () => page.el.querySelector(".yui-chars__count")!.textContent;
  return { petWindows, row, sw, meta, count };
}

it("lists every character with its state; main's switch is on and locked", () => {
  const { sw, meta, count, row } = build();

  expect(meta("natsume")).toBe("In main · always on");
  expect([sw("natsume").getAttribute("aria-checked"), sw("natsume").disabled]).toEqual([
    "true",
    true,
  ]);
  expect(meta("perlica")).toBe("Off · settings kept");
  expect([sw("perlica").getAttribute("aria-checked"), sw("perlica").disabled]).toEqual([
    "false",
    false,
  ]);
  expect(row("perlica").querySelector(".yui-uc__dot, .yui-uc__avatar")).not.toBeNull();
  expect(count()).toBe("1 of 4 on the desktop");
});

it("switching an off row opens it on the desktop, and switching it again closes it", () => {
  const { sw, meta, count, petWindows } = build();

  fireEvent.click(sw("perlica"));
  expect(petWindows.get()).toEqual(["bbbb0002"]);
  expect(meta("perlica")).toBe("On the desktop");
  expect(count()).toBe("2 of 4 on the desktop");

  fireEvent.click(sw("perlica"));
  expect(petWindows.get()).toEqual([]);
  expect(meta("perlica")).toBe("Off · settings kept");
});

it("at the cap an off row's switch is disabled with the reason, and the four stay", () => {
  const { sw, row, petWindows, count } = build();
  for (const name of ["perlica", "shino", "klukai"]) fireEvent.click(sw(name));

  expect(count()).toBe("4 of 4 on the desktop");
  expect(sw("carlotta").disabled).toBe(true);
  const reason = row("carlotta").querySelector<HTMLElement>(".yui-chars__reason")!;
  expect([reason.hidden, reason.textContent]).toEqual([
    false,
    "Up to 4 at once. Turn one off first.",
  ]);
  expect(petWindows.open("eeee0005")).toBe(false);
  expect(petWindows.get()).toEqual(["bbbb0002", "cccc0003", "dddd0004"]);
  expect(row("perlica").querySelector<HTMLElement>(".yui-chars__reason")!.hidden).toBe(true);
});

it("in a bound window its own character is locked on, with the reason", () => {
  const { sw, row, petWindows } = build("bbbb0002");

  expect([sw("perlica").getAttribute("aria-checked"), sw("perlica").disabled]).toEqual([
    "true",
    true,
  ]);
  const reason = row("perlica").querySelector<HTMLElement>(".yui-chars__reason")!;
  expect([reason.hidden, reason.textContent]).toEqual([false, "This window's character"]);
  fireEvent.click(sw("perlica"));
  expect(petWindows.get()).toEqual(["bbbb0002"]);
});

// jsdom computes no stylesheet display; `.yui-chars__reason[hidden]` keeps the attribute decisive.
it("hides a reason line whose hidden attribute is set", () => {
  const css = readFileSync(resolve(__dirname, "characters-section.css"), "utf-8");
  expect(css).toMatch(/\n\.yui-chars__reason\[hidden\] \{\s*display: none;\s*\}/);
});

it("a switch another window beat to the last place logs nothing and shows the reason", () => {
  const { sw, row, petWindows } = build();
  for (const name of ["perlica", "shino"]) fireEvent.click(sw(name));
  const invalidate = vi.spyOn(petWindows, "invalidate");
  log.info.mockClear();
  createPetWindows().open("dddd0004");

  fireEvent.click(sw("carlotta"));

  expect(petWindows.get()).toEqual(["bbbb0002", "cccc0003", "dddd0004"]);
  expect(invalidate).toHaveBeenCalled();
  expect(log.info).not.toHaveBeenCalled();
  expect(row("carlotta").querySelector<HTMLElement>(".yui-chars__reason")!.hidden).toBe(false);
});
