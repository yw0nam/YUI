// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../../settings/persisted-store";
import { createPetWindows } from "../../../settings/preset/pet-windows";
import { createPresetRegistry } from "../../../settings/preset/preset-registry";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "../test-helpers";

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("en");
});

function build() {
  const mount = document.body.appendChild(document.createElement("div"));
  const qc = createQuickControls({
    ...defaultQcArgs(mount),
    gazeSettings: createFlagSettings(true),
    onResetViewpoint: vi.fn(),
    presetRegistry: createPresetRegistry(),
    petWindows: createPetWindows(),
  });
  const input = qc.el.querySelector<HTMLInputElement>(".yui-search__input")!;
  const search = (q: string) => {
    input.value = q;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const tab = (page: string) => qc.el.querySelector<HTMLElement>(`#yui-tab-${page}`)!;
  const count = (page: string) => {
    const badge = tab(page).querySelector<HTMLElement>(".yui-tab__count")!;
    return badge.hidden ? null : badge.textContent;
  };
  const gazeRow = () => qc.el.querySelector(".yui-gaze-switch")!.closest(".yui-row")!;
  return { qc, input, search, tab, count, gazeRow };
}

it.each([
  ["en", "mouse CURSOR"],
  ["ko", "커서"],
])("finds a row by words of its sub-line in %s and counts matches per page", (locale, query) => {
  setLocale(locale as "en" | "ko");
  const { qc, search, tab, count, gazeRow } = build();

  search(query);

  expect(count("motion")).toBe("1");
  expect(gazeRow().classList.contains("is-match")).toBe(true);
  expect(count("perms")).toBe("0");
  expect(tab("perms").classList.contains("is-dim")).toBe(true);
  expect(tab("motion").classList.contains("is-dim")).toBe(false);
  qc.dispose();
});

it.each(["clear", "Escape"])("%s restores the rail and the rows", (how) => {
  const { qc, input, search, tab, count, gazeRow } = build();
  search("cursor");

  if (how === "clear") search("");
  else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  expect(input.value).toBe("");
  expect([count("motion"), count("perms")]).toEqual([null, null]);
  expect(tab("perms").classList.contains("is-dim")).toBe(false);
  expect(gazeRow().classList.contains("is-match")).toBe(false);
  expect(qc.isOpen()).toBe(true);
  qc.dispose();
});

it.each([
  ["Use interjections", "voice", ".yui-filler .yui-sec__head"],
  ["Reset to front", "body", ".yui-viewpoint-reset"],
])("finds %s, which rides a section head", (query, page, sel) => {
  const { qc, search, count } = build();

  search(query);

  expect(count(page)).toBe("1");
  expect(qc.el.querySelector(sel)!.closest(".is-match")).not.toBeNull();
  qc.dispose();
});

it.each([
  ["backend picks the model", "conn"],
  ["Turn one off first", "together"],
])("skips the hidden reason line %s", (query, page) => {
  const { qc, search, count } = build();

  search(query);

  expect(count(page)).toBe("0");
  qc.dispose();
});
