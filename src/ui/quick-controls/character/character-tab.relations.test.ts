// @vitest-environment jsdom
// The Character tab's Relations section: the rows, the slider's preview and commit, and the switch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRelationsStore, type Relations } from "../../../settings/relations/relations-store";
import { createRelationsSwitch } from "../../../settings/relations/relations-switch";
import { setLocale } from "../../i18n";
import { makeVrmSelection } from "../test-helpers";
import { type CharacterRows, createCharacterTab } from "./character-tab";

const NOW = new Date(2026, 9, 22, 12, 0).getTime();
const HOUR = 3_600_000;

const ROWS: CharacterRows = {
  vrms: true,
  gain: false,
  idleMotion: false,
  expressMotion: false,
  bedScene: false,
  viewpoint: false,
  relations: true,
};

const PRESETS = [
  { id: "default", name: "natsume" },
  { id: "aaaa0001", name: "shino" },
  { id: "bbbb0002", name: "carlotta" },
  { id: "cccc0003", name: "klukai" },
];

const OWN: Relations = {
  user: { value: 9, updated_at: NOW - HOUR, log: [{ at: NOW - HOUR, delta: 2, why: "said hi" }] },
  aaaa0001: { value: 14, updated_at: NOW - HOUR, log: [] },
  bbbb0002: { value: -6, updated_at: NOW - HOUR, log: [] },
};

describe("createCharacterTab — relations", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  function build() {
    const store = createRelationsStore({ storage: { load: () => OWN, save: () => {} } });
    const relationsSwitch = createRelationsSwitch({ load: () => null, save() {} });
    const tab = createCharacterTab({
      rows: ROWS,
      variant: "panel",
      vrmSelection: makeVrmSelection(),
      swapVrm: async () => {},
      importVrm: async () => {},
      removeUserVrm: async () => {},
      isOpen: () => true,
      log,
      relations: { store, relationsSwitch, self: "default", presets: () => PRESETS },
    });
    document.body.append(tab.el);
    tab.refresh();
    const rows = () => [...tab.el.querySelectorAll<HTMLElement>(".yui-relations__row")];
    const row = (target: string) =>
      tab.el.querySelector<HTMLElement>(`.yui-relations__row[data-target="${target}"]`)!;
    return { tab, store, rows, row };
  }

  it("lists rated targets first, you first then close first, and unrated targets after", () => {
    const { tab, rows, row } = build();
    const klukai = row("cccc0003");

    expect(rows().map((r) => r.dataset.target)).toEqual([
      "user",
      "aaaa0001",
      "bbbb0002",
      "cccc0003",
    ]);
    expect(klukai.classList.contains("is-unrated")).toBe(true);
    expect(klukai.querySelector(".yui-relations__value")?.textContent).toBe("0");
    expect(klukai.querySelector(".yui-row__sub")?.textContent).toBe("Not rated yet");
    tab.dispose();
  });

  it("previews a drag without writing, then commits on change with the manual reason, without the daily cap", () => {
    const { tab, store, rows, row } = build();
    const slider = row("cccc0003").querySelector<HTMLInputElement>(".yui-relations__slider")!;
    slider.focus();

    slider.value = "5";
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(row("cccc0003").querySelector(".yui-relations__value")?.textContent).toBe("+5");
    expect(slider.getAttribute("aria-valuetext")).toBe("warm, +5");
    expect(store.all().cccc0003).toBeUndefined();

    slider.dispatchEvent(new Event("change", { bubbles: true }));

    expect(store.all().cccc0003).toEqual({
      value: 5,
      updated_at: NOW,
      log: [{ at: NOW, delta: 5, why: "set by the user" }],
    });
    expect(rows().map((r) => r.dataset.target)).toEqual([
      "user",
      "aaaa0001",
      "cccc0003",
      "bbbb0002",
    ]);
    expect(row("cccc0003").querySelector(".yui-row__sub")?.textContent).toBe(
      "warm · set by you · 0min",
    );
    expect(row("cccc0003").querySelector(".yui-relations__slider")).toBe(slider);
    expect(document.activeElement).toBe(slider);
    tab.dispose();
  });

  it("restores an unrated row released at 0 without writing or logging", () => {
    const { tab, store, row } = build();
    const slider = row("cccc0003").querySelector<HTMLInputElement>(".yui-relations__slider")!;

    for (const value of ["5", "0"]) {
      slider.value = value;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
    slider.dispatchEvent(new Event("change", { bubbles: true }));

    expect(store.all().cccc0003).toBeUndefined();
    expect(row("cccc0003").classList.contains("is-unrated")).toBe(true);
    expect(row("cccc0003").querySelector(".yui-row__sub")?.textContent).toBe("Not rated yet");
    expect(row("cccc0003").querySelector<HTMLElement>(".yui-glyph")?.dataset.band).toBe("none");
    expect(log.info).not.toHaveBeenCalledWith("relation_set", expect.anything());
    tab.dispose();
  });

  it("hides the rows while the switch is off and shows them again", () => {
    const { tab } = build();
    const toggle = tab.el.querySelector<HTMLButtonElement>(".yui-relations__switch")!;
    const shown = () =>
      [".yui-relations__rows", ".yui-relations__note", ".yui-relations__off"].map(
        (s) => !tab.el.querySelector<HTMLElement>(s)!.hidden,
      );

    toggle.click();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(shown()).toEqual([false, false, true]);

    toggle.click();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(shown()).toEqual([true, true, false]);
    tab.dispose();
  });
});
