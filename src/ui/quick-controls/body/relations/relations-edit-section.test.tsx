// @vitest-environment jsdom
// The Body page's Relations section: the rows, the slider's preview and commit, and the switch's effect.

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRelationsStore,
  type Relations,
} from "../../../../settings/relations/relations-store";
import { createRelationsSwitch } from "../../../../settings/relations/relations-switch";
import { setLocale } from "../../../i18n";
import { type CharacterRows, createCharacterTab } from "../../character/character-tab";
import { makeVrmSelection } from "../../test-helpers";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tabs: ReturnType<typeof createCharacterTab>[] = [];

const NOW = new Date(2026, 9, 22, 12, 0).getTime();
const HOUR = 3_600_000;

const ROWS: CharacterRows = {
  vrms: true,
  gain: false,
  idleMotion: false,
  expressMotion: false,
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
    act(() => {
      for (const tab of tabs.splice(0)) tab.dispose();
    });
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  function build() {
    const store = createRelationsStore({ storage: { load: () => OWN, save: () => {} } });
    const relationsSwitch = createRelationsSwitch({ load: () => null, save() {} });
    const tab = createCharacterTab({
      rows: ROWS,
      vrmSelection: makeVrmSelection(),
      swapVrm: async () => {},
      importVrm: async () => {},
      removeUserVrm: async () => {},
      isOpen: () => true,
      log,
      relations: { store, relationsSwitch, self: "default", presets: () => PRESETS },
    });
    tabs.push(tab);
    document.body.append(tab.el);
    act(() => tab.refresh());
    const rows = () => [...tab.el.querySelectorAll<HTMLElement>(".yui-relations__row")];
    const row = (target: string) =>
      tab.el.querySelector<HTMLElement>(`.yui-relations__row[data-target="${target}"]`)!;
    return { tab, store, relationsSwitch, rows, row };
  }

  it("lists rated targets first, you first then close first, and unrated targets after", () => {
    const { rows, row } = build();
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
    expect(klukai.querySelector(".yui-relations__slider")?.getAttribute("aria-valuetext")).toBe(
      "Not rated yet",
    );
  });

  it("previews a drag without writing, then commits on change with the manual reason, without the daily cap", () => {
    const { store, rows, row } = build();
    const slider = row("cccc0003").querySelector<HTMLInputElement>(".yui-relations__slider")!;
    slider.focus();

    act(() => {
      fireEvent.input(slider, { target: { value: "5" } });
    });

    expect(row("cccc0003").querySelector(".yui-relations__value")?.textContent).toBe("+5");
    expect(slider.getAttribute("aria-valuetext")).toBe("warm, +5");
    expect(store.all().cccc0003).toBeUndefined();

    act(() => {
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });

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
  });

  it("a release that writes nothing leaves no claim on focus for a later write elsewhere", () => {
    const { row } = build();
    const slider = (target: string) =>
      row(target).querySelector<HTMLInputElement>(".yui-relations__slider")!;
    const earlier = slider("user");
    const later = slider("aaaa0001");

    later.focus();
    act(() => {
      later.dispatchEvent(new Event("change", { bubbles: true }));
    });
    earlier.focus();
    act(() => {
      fireEvent.input(earlier, { target: { value: "8" } });
    });
    act(() => {
      earlier.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.activeElement).toBe(earlier);
  });

  it("restores an unrated row released at 0 without writing or logging", () => {
    const { store, row } = build();
    const slider = row("cccc0003").querySelector<HTMLInputElement>(".yui-relations__slider")!;

    for (const value of ["5", "0"]) {
      act(() => {
        fireEvent.input(slider, { target: { value } });
      });
    }
    act(() => {
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(store.all().cccc0003).toBeUndefined();
    expect(row("cccc0003").classList.contains("is-unrated")).toBe(true);
    expect(row("cccc0003").querySelector(".yui-row__sub")?.textContent).toBe("Not rated yet");
    expect(row("cccc0003").querySelector<HTMLElement>(".yui-glyph")?.dataset.band).toBe("none");
    expect(slider.getAttribute("aria-valuetext")).toBe("Not rated yet");
    expect(log.info).not.toHaveBeenCalledWith("relation_set", expect.anything());
  });

  it("hides the rows while the switch is off and shows them again", () => {
    const { tab, relationsSwitch } = build();
    const shown = () =>
      [".yui-relations__rows", ".yui-relations__note", ".yui-relations__off"].map(
        (s) => !tab.el.querySelector<HTMLElement>(s)!.hidden,
      );

    act(() => relationsSwitch.setEnabled(false));
    expect(shown()).toEqual([false, false, true]);

    act(() => relationsSwitch.setEnabled(true));
    expect(shown()).toEqual([true, true, false]);
  });
});
