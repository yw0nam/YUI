// @vitest-environment jsdom
/**
 * not_configured affordance, end to end: the inline input error carries a button
 * that opens the quick-controls panel on the Advanced tab (real surfaces + real panel).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "./i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./quick-controls/test-helpers";
import { createSurfaces } from "./surfaces";
import { turnErrorFixAction, turnErrorMessage } from "./turn-error";

describe("not_configured → open the Advanced tab", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    setLocale("en");
  });

  it("clicking the inline error's button opens quick controls on Advanced", () => {
    const surfaces = createSurfaces({ mount });
    const quickControls = createQuickControls(defaultQcArgs(mount));

    // The bootstrap wiring: message + optional fix action for the failed turn.
    const message = turnErrorMessage("not_configured")!;
    surfaces.showInputError(
      message,
      turnErrorFixAction("not_configured", (tab) => quickControls.open(undefined, { tab })),
    );

    const button = surfaces.el.querySelector<HTMLButtonElement>(".yui-input__error-action")!;
    expect(button).not.toBeNull();
    expect(quickControls.isOpen()).toBe(false);

    button.click();

    expect(quickControls.isOpen()).toBe(true);
    const adv = quickControls.el.querySelector<HTMLButtonElement>("#yui-tab-adv")!;
    expect(adv.getAttribute("aria-selected")).toBe("true");
    expect(
      quickControls.el.querySelector<HTMLElement>(`#${adv.getAttribute("aria-controls")}`)!.hidden,
    ).toBe(false);

    quickControls.dispose();
    surfaces.dispose();
  });

  it("failures the panel cannot fix render no affordance", () => {
    const surfaces = createSurfaces({ mount });

    surfaces.showInputError(
      turnErrorMessage("network_drop")!,
      turnErrorFixAction("network_drop", () => {}),
    );

    expect(surfaces.el.querySelector(".yui-input__error-action")).toBeNull();

    surfaces.dispose();
  });
});
