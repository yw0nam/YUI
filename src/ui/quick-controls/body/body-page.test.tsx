// @vitest-environment jsdom
/**
 * body-page.test.tsx — the Body page: the VRM list and the view reset render, and the open hook
 * and the stores redraw them.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRelationsStore } from "../../../settings/relations/relations-store";
import { createRelationsSwitch } from "../../../settings/relations/relations-switch";
import { setLocale, t } from "../../i18n";
import { makeVrmSelection, pressSlider, USER_OPTION } from "../test-helpers";
import { createBodyPage } from "./body-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tabs: ReturnType<typeof createBodyPage>[] = [];

describe("createBodyPage", () => {
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

  function build(overrides: Partial<Parameters<typeof createBodyPage>[0]> = {}) {
    const vrmSelection = makeVrmSelection();
    const onResetView = vi.fn();
    const importVrm = vi.fn(async () => {});
    const tab = createBodyPage({
      vrmSelection,
      swapVrm: async () => {},
      importVrm,
      removeUserVrm: async () => {},
      onResetView,
      isOpen: () => true,
      log,
      host: document.body,
      ...overrides,
    });
    tabs.push(tab);
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

  it("an open drops an armed remove, so the next click only arms again", () => {
    const vrmSelection = makeVrmSelection();
    vrmSelection.addUserOption(USER_OPTION);
    const removeUserVrm = vi.fn(async () => {});
    const { tab } = build({ vrmSelection, removeUserVrm });
    act(() => tab.refresh());
    const row = () => tab.el.querySelector<HTMLElement>('.yui-vrm[data-vrm-id="cat"]')!;
    const remove = () => row().querySelector<HTMLButtonElement>(".yui-vrm__remove")!;

    act(() => remove().click());
    expect(row().classList.contains("is-remove-armed")).toBe(true);
    act(() => tab.refresh());
    expect(row().classList.contains("is-remove-armed")).toBe(false);
    act(() => remove().click());

    expect(row().classList.contains("is-remove-armed")).toBe(true);
    expect(removeUserVrm).not.toHaveBeenCalled();
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

  it("takes a pointer press on a relations slider", () => {
    const store = createRelationsStore({ storage: { load: () => ({}), save: () => {} } });
    const { tab } = build({
      relations: {
        store,
        relationsSwitch: createRelationsSwitch({ load: () => null, save() {} }),
        self: "default",
        presets: () => [{ id: "default", name: "natsume" }],
      },
    });
    const slider = tab.el.querySelector<HTMLInputElement>(
      '.yui-relations__row[data-target="user"] input',
    )!;

    pressSlider(slider, 0.625).release();

    expect(store.all().user?.value).toBe(5);
  });
});
