// @vitest-environment jsdom
/**
 * browser-section.test.ts — the browser-use switch on the Input tab: its row and caution render only
 * with the store, the row follows the store while the panel is open, and a click flips the store.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../../logger";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createVadSettings } from "../../../../settings/voice/vad-settings";
import { setLocale } from "../../../i18n";
import { createSwitchRows } from "../../switch-row";
import { buildPanelHtml } from "../../template";
import { createBrowserSection } from "./browser-section";

function panel(showBrowser: boolean): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    isWindow: false,
    hasSession: false,
    switchRows: createSwitchRows({
      idleThrottleSettings: createFlagSettings(false),
      vad: createVadSettings(),
    }),
    showScreen: false,
    showPresence: false,
    showPacerGap: false,
    showRateLimits: false,
    showDevtools: false,
    showHelp: false,
    showMessage: false,
    showHistory: false,
    showBrowser,
  });
  document.body.append(root);
  return root;
}

function build({ open = true }: { open?: boolean } = {}) {
  const settings = createFlagSettings(false);
  const root = panel(true);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const section = createBrowserSection({ root, settings, log, isOpen: () => open });
  section.reflect();
  const switchBtn = root.querySelector<HTMLButtonElement>(".yui-browser-switch")!;
  const sub = switchBtn.closest(".yui-row")!.querySelector(".yui-row__sub")!;
  return { root, settings, log, section, switchBtn, sub };
}

describe("createBrowserSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  it("renders the switch row and its caution in the Input tab only with the store", () => {
    const without = panel(false);
    expect(without.querySelector(".yui-browser-switch")).toBeNull();
    without.remove();

    const root = panel(true);
    const switchBtn = root.querySelector("#yui-panel-input .yui-browser-switch");
    expect(switchBtn?.getAttribute("aria-label")).toBe("Allow browser use");
    const sec = switchBtn?.closest(".yui-sec");
    const screenshotSec = root.querySelector(".yui-screenshot-switch")?.closest(".yui-sec");
    expect(screenshotSec?.nextElementSibling).toBe(sec);
    expect(sec?.querySelector(".yui-sec__foot")?.textContent).toBe(
      "There is no sandbox: a script can read your files, run programs, and reach every site signed in on ego lite's YUI profile.",
    );
  });

  it("follows the store while open: the switch and its sub text", () => {
    const { settings, switchBtn, sub } = build();
    expect(switchBtn.getAttribute("aria-checked")).toBe("false");
    expect(sub.textContent).toMatch(/^Off by default\./);

    settings.setEnabled(true);

    expect(switchBtn.getAttribute("aria-checked")).toBe("true");
    expect(sub.textContent).toMatch(/^While on,/);
  });

  it("flips the store on click and logs the toggle", () => {
    const { settings, log, switchBtn } = build();

    switchBtn.click();

    expect(settings.get().enabled).toBe(true);
    expect(log.info).toHaveBeenCalledWith("browser_toggle", { enabled: true });
  });

  it("stops following the store and the click once disposed", () => {
    const { settings, section, switchBtn } = build();
    section.dispose();

    settings.setEnabled(true);
    expect(switchBtn.getAttribute("aria-checked")).toBe("false");
    switchBtn.click();
    expect(settings.get().enabled).toBe(true);
  });
});
