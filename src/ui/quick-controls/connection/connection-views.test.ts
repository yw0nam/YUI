// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { createConnectionViews } from "./connection-views";

function setup(initial: "quick" | "detail" = "quick") {
  const panel = document.createElement("div");
  panel.className = "yui-tabpanel";
  panel.innerHTML = `
    <p class="yui-tabpanel__scope"></p>
    <h1 class="yui-tabpanel__title">Connection</h1>
  `;
  const quick = document.createElement("div");
  quick.textContent = "quick";
  const detail = document.createElement("div");
  detail.textContent = "detail";
  document.body.append(panel);
  const onQuickShown = vi.fn();
  const onDetailEntered = vi.fn();
  const views = createConnectionViews({
    panel,
    quick,
    detail,
    initial,
    onQuickShown,
    onDetailEntered,
  });
  const wrapper = (view: string) =>
    panel.querySelector<HTMLElement>(`.yui-conn-view[data-view="${view}"]`)!;
  const cell = (view: string) =>
    panel.querySelector<HTMLButtonElement>(`.yui-seg__btn[data-view="${view}"]`)!;
  const scope = () => panel.querySelector<HTMLElement>(".yui-tabpanel__scope")!;
  return { panel, quick, detail, views, onQuickShown, onDetailEntered, wrapper, cell, scope };
}

describe("createConnectionViews", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens on Quick start: the quick view shows, the detail view and the scope line hide", () => {
    const s = setup("quick");

    expect(s.wrapper("quick").hidden).toBe(false);
    expect(s.wrapper("detail").hidden).toBe(true);
    expect(s.scope().hidden).toBe(true);
    expect(s.cell("quick").getAttribute("aria-checked")).toBe("true");
    expect(s.cell("quick").tabIndex).toBe(0);
    expect(s.cell("detail").getAttribute("aria-checked")).toBe("false");
    expect(s.cell("detail").tabIndex).toBe(-1);

    s.views.entered();
    expect(s.onDetailEntered).not.toHaveBeenCalled();
    expect(s.onQuickShown).not.toHaveBeenCalled();
  });

  it("clicking Detailed settings shows it, shows the scope line and enters the detail view", () => {
    const s = setup("quick");

    s.cell("detail").click();

    expect(s.wrapper("detail").hidden).toBe(false);
    expect(s.wrapper("quick").hidden).toBe(true);
    expect(s.scope().hidden).toBe(false);
    expect(s.onDetailEntered).toHaveBeenCalledTimes(1);
    expect(s.onQuickShown).not.toHaveBeenCalled();
  });

  it("entering the Connection page while the detail view shows enters it", () => {
    const s = setup("quick");
    s.cell("detail").click();
    s.onDetailEntered.mockClear();

    s.views.entered();

    expect(s.onDetailEntered).toHaveBeenCalledTimes(1);
  });

  it("clicking Quick start goes back and re-reads its state", () => {
    const s = setup("quick");
    s.cell("detail").click();
    s.onQuickShown.mockClear();

    s.cell("quick").click();

    expect(s.wrapper("quick").hidden).toBe(false);
    expect(s.wrapper("detail").hidden).toBe(true);
    expect(s.scope().hidden).toBe(true);
    expect(s.onQuickShown).toHaveBeenCalledTimes(1);

    s.cell("quick").click();
    expect(s.onQuickShown).toHaveBeenCalledTimes(1);
  });

  it("ArrowRight moves the selection to Detailed settings", () => {
    const s = setup("quick");
    s.cell("quick").focus();

    s.cell("quick").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(s.cell("detail").getAttribute("aria-checked")).toBe("true");
    expect(s.wrapper("detail").hidden).toBe(false);
    expect(s.onDetailEntered).toHaveBeenCalledTimes(1);
  });
});
