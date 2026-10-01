// @vitest-environment jsdom
/**
 * tab-rail.test.ts — the shared tablist: selection callbacks, keyboard focus, listener removal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { createTabRail, tabButtonHtml } from "./tab-rail";

describe("createTabRail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function build(onSelect?: (id: string) => void) {
    setLocale("en");
    document.body.innerHTML = `
      <div id="rail" role="tablist">${tabButtonHtml("conn", "", { selected: true })}${tabButtonHtml("hist", "")}</div>
      <div role="tabpanel" id="yui-panel-conn"></div>
      <div role="tabpanel" id="yui-panel-hist" hidden></div>`;
    const rail = document.getElementById("rail")!;
    const tabRail = createTabRail({
      rail,
      buttons: Array.from(rail.querySelectorAll<HTMLButtonElement>(".yui-tab")),
      panels: Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')),
      initial: "conn",
      onSelect,
    });
    return { rail, tabRail };
  }

  it("fires onSelect for a click and for a programmatic select", () => {
    const onSelect = vi.fn();
    const { rail, tabRail } = build(onSelect);

    rail.querySelector<HTMLButtonElement>("#yui-tab-hist")!.click();
    tabRail.select("conn");

    expect(onSelect.mock.calls).toEqual([["hist"], ["conn"]]);
    expect(tabRail.selected()).toBe("conn");
    tabRail.dispose();
  });

  it("keyboard navigation keeps the keyboard focus ring; an explicit focus option overrides it", () => {
    const { rail, tabRail } = build();
    const hist = rail.querySelector<HTMLButtonElement>("#yui-tab-hist")!;
    const focus = vi.spyOn(hist, "focus");

    rail
      .querySelector("#yui-tab-conn")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(focus).toHaveBeenLastCalledWith({});

    tabRail.select("hist", { focusVisible: false });
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
    tabRail.dispose();
  });

  it("dispose removes the click and keyboard listeners", () => {
    const onSelect = vi.fn();
    const { rail, tabRail } = build(onSelect);
    tabRail.dispose();

    rail.querySelector<HTMLButtonElement>("#yui-tab-hist")!.click();
    rail
      .querySelector("#yui-tab-conn")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
