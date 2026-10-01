// @vitest-environment jsdom
/**
 * character-tab.test.ts — the extracted Character tab: the phone rows render and bind only the
 * VRM list and the view reset; the desktop rows add the gain slider, whose preview ends on close.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLipsyncSettings } from "../../../settings/avatar/lipsync-settings";
import { setLocale, t } from "../../i18n";
import { makeVrmSelection, USER_OPTION } from "../test-helpers";
import { type CharacterRows, createCharacterTab } from "./character-tab";

const PHONE_ROWS: CharacterRows = {
  vrms: true,
  gain: false,
  idleMotion: false,
  expressMotion: false,
  viewpoint: true,
};

describe("createCharacterTab", () => {
  beforeEach(() => {
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  function build(overrides: Partial<Parameters<typeof createCharacterTab>[0]> = {}) {
    const vrmSelection = makeVrmSelection();
    const onResetView = vi.fn();
    const importVrm = vi.fn(async () => {});
    const tab = createCharacterTab({
      rows: PHONE_ROWS,
      variant: "phone",
      vrmSelection,
      swapVrm: async () => {},
      importVrm,
      removeUserVrm: async () => {},
      onResetView,
      isOpen: () => true,
      log,
      ...overrides,
    });
    document.body.append(tab.el);
    return { tab, vrmSelection, onResetView, importVrm };
  }

  it("phone rows render the VRM list and the view reset, and nothing else", () => {
    const { tab } = build();
    expect(tab.el.querySelector(".yui-vrms")).not.toBeNull();
    expect(tab.el.querySelector(".yui-vrm--add")).not.toBeNull();
    expect(tab.el.querySelector(".yui-viewpoint-reset")).not.toBeNull();
    expect(tab.el.querySelector(".yui-lipsync-gain__slider")).toBeNull();
    expect(tab.el.querySelector(".yui-idle-motion")).toBeNull();
    expect(tab.el.querySelector(".yui-express-motion")).toBeNull();
    // The phone's reset row carries its own copy.
    expect(tab.el.textContent).toContain(t("viewpoint.reset_view_label"));
    expect(tab.el.textContent).toContain(t("viewpoint.reset_view_sub"));
    tab.dispose();
  });

  it("refresh lists bundled rows as buttons and user rows as divs; the add button imports", () => {
    const { tab, vrmSelection, importVrm } = build();
    vrmSelection.addUserOption(USER_OPTION);
    tab.refresh();
    const rows = Array.from(tab.el.querySelectorAll<HTMLElement>(".yui-vrms > [role=radio]"));
    expect(rows.map((r) => r.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON", "DIV"]);
    tab.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!.click();
    expect(importVrm).toHaveBeenCalledTimes(1);
    tab.dispose();
  });

  it("the reset button calls onResetView", () => {
    const { tab, onResetView } = build();
    tab.el.querySelector<HTMLButtonElement>(".yui-viewpoint-reset")!.click();
    expect(onResetView).toHaveBeenCalledTimes(1);
    tab.dispose();
  });

  it("repaints on a selection change while open and stops after dispose", () => {
    const { tab, vrmSelection } = build();
    tab.refresh();
    vrmSelection.select("aria");
    const checked = () =>
      tab.el.querySelector<HTMLElement>(".yui-vrm[aria-checked=true]")?.dataset.vrmId;
    expect(checked()).toBe("aria");
    tab.dispose();
    const unsubscribed = vi.fn();
    const spy = { ...vrmSelection, subscribe: vi.fn(() => unsubscribed) };
    const second = build({ vrmSelection: spy });
    second.tab.dispose();
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it("the gain row ends its preview when the tab closes", () => {
    const onPreview = vi.fn();
    const onPreviewEnd = vi.fn();
    const { tab } = build({
      rows: { ...PHONE_ROWS, gain: true },
      variant: "panel",
      gain: { lipsync: createLipsyncSettings(), onPreview, onPreviewEnd },
    });
    tab.refresh();
    const slider = tab.el.querySelector<HTMLInputElement>(".yui-lipsync-gain__slider")!;
    slider.value = "3";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    tab.close();
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
    tab.dispose();
  });
});
