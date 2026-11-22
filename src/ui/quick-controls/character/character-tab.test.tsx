// @vitest-environment jsdom
/**
 * character-tab.test.ts — the extracted Character tab: the rows render and bind only the
 * VRM list and the view reset; further rows add the gain slider and the motion lists.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../../i18n";
import { makeVrmSelection } from "../test-helpers";
import { type CharacterRows, createCharacterTab } from "./character-tab";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tabs: ReturnType<typeof createCharacterTab>[] = [];

const ROWS: CharacterRows = {
  vrms: true,
  gain: false,
  idleMotion: false,
  expressMotion: false,
  viewpoint: true,
  relations: false,
};

describe("createCharacterTab", () => {
  beforeEach(() => {
    setLocale("en");
  });

  afterEach(() => {
    act(() => {
      for (const tab of tabs.splice(0)) tab.dispose();
    });
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  function build(overrides: Partial<Parameters<typeof createCharacterTab>[0]> = {}) {
    const vrmSelection = makeVrmSelection();
    const onResetView = vi.fn();
    const importVrm = vi.fn(async () => {});
    const tab = createCharacterTab({
      rows: ROWS,
      vrmSelection,
      swapVrm: async () => {},
      importVrm,
      removeUserVrm: async () => {},
      onResetView,
      isOpen: () => true,
      log,
      ...overrides,
    });
    tabs.push(tab);
    document.body.append(tab.el);
    return { tab, vrmSelection, onResetView, importVrm };
  }

  it("renders the VRM list and the view reset, and nothing else", () => {
    const { tab } = build();
    expect(tab.el.querySelector(".yui-vrms")).not.toBeNull();
    expect(tab.el.querySelector(".yui-vrm--add")).not.toBeNull();
    expect(tab.el.querySelector(".yui-viewpoint-reset")).not.toBeNull();
    expect(tab.el.querySelector(".yui-lipsync-gain__slider")).toBeNull();
    expect(tab.el.querySelector(".yui-idle-motion")).toBeNull();
    expect(tab.el.querySelector(".yui-express-motion")).toBeNull();
    expect(tab.el.textContent).toContain(t("viewpoint.section"));
    expect(tab.el.textContent).toContain(t("viewpoint.reset"));
  });

  it("shows a selection change made while closed on the next refresh", () => {
    let open = true;
    const { tab, vrmSelection } = build({ isOpen: () => open });
    act(() => tab.refresh());
    const checked = () =>
      tab.el.querySelector<HTMLElement>(".yui-vrm[aria-checked=true]")?.dataset.vrmId;

    open = false;
    act(() => vrmSelection.select("aria"));
    expect(checked()).toBe("carlotta");

    act(() => tab.refresh());
    expect(checked()).toBe("aria");
  });

  it("repaints on a selection change while open and stops after dispose", () => {
    const { tab, vrmSelection } = build();
    act(() => tab.refresh());
    act(() => vrmSelection.select("aria"));
    const checked = () =>
      tab.el.querySelector<HTMLElement>(".yui-vrm[aria-checked=true]")?.dataset.vrmId;
    expect(checked()).toBe("aria");
    act(() => tab.dispose());
    const unsubscribed = vi.fn();
    const spy = { ...vrmSelection, subscribe: vi.fn(() => unsubscribed) };
    const second = build({ vrmSelection: spy });
    act(() => second.tab.dispose());
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });
});
