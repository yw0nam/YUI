// @vitest-environment jsdom
/**
 * not_configured affordance, end to end: the inline input error carries a button that opens the
 * settings window on the Connection page (real surfaces, the opener stubbed).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { createSurfaces } from "../surfaces/surfaces";
import { noTool } from "../surfaces/test-helpers";
import { turnErrorFixAction, turnErrorMessage } from "./turn-error";

describe("not_configured → open the Connection page", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  it("the inline error's fix button opens the settings window on the Connection page", () => {
    const surfaces = createSurfaces({ tool: noTool, mount });
    const openSettings = vi.fn();

    // The bootstrap wiring: message + optional fix action for the failed turn.
    surfaces.showInputError(
      turnErrorMessage("not_configured")!,
      turnErrorFixAction("not_configured", openSettings),
    );

    const button = surfaces.el.querySelector<HTMLButtonElement>(".yui-input__error-action")!;
    expect(button).not.toBeNull();
    expect(openSettings).not.toHaveBeenCalled();

    button.click();

    expect(openSettings).toHaveBeenCalledExactlyOnceWith("conn");

    surfaces.dispose();
  });

  it("failures the panel cannot fix render no affordance", () => {
    const surfaces = createSurfaces({ tool: noTool, mount });

    surfaces.showInputError(
      turnErrorMessage("network_drop")!,
      turnErrorFixAction("network_drop", () => {}),
    );

    expect(surfaces.el.querySelector(".yui-input__error-action")).toBeNull();

    surfaces.dispose();
  });
});
