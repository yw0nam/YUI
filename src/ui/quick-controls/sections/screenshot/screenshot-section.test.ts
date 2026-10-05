// @vitest-environment jsdom
/**
 * screenshot-section.test.ts — the screenshot-attach switch and the monitor list on the panel's real
 * markup: redraw and load on a store change while open, the split between reflect() and the load,
 * and teardown.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../../logger";
import { createScreenshotSettings } from "../../../../settings/capture/screenshot-settings";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createVadSettings } from "../../../../settings/voice/vad-settings";
import { setLocale } from "../../../i18n";
import { createSwitchRows } from "../../switch-row";
import { buildPanelHtml } from "../../template";
import { createScreenshotSection } from "./screenshot-section";

function build({ enabled = false, open = true }: { enabled?: boolean; open?: boolean } = {}) {
  const settings = createScreenshotSettings();
  if (enabled) settings.setEnabled(true);
  const listMonitors = vi.fn(async () => [{ index: 0, primary: true }]);
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
  });
  document.body.append(root);
  const section = createScreenshotSection({
    root,
    settings,
    sourceProvider: { listMonitors },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger,
    isOpen: () => open,
  });
  const switchBtn = root.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  return { root, settings, listMonitors, section, switchBtn };
}

describe("createScreenshotSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
    vi.restoreAllMocks();
  });

  it("enabling the store while open checks the switch and lists the monitors once", () => {
    const { settings, listMonitors, switchBtn } = build();

    settings.setEnabled(true);

    expect(switchBtn.getAttribute("aria-checked")).toBe("true");
    expect(listMonitors).toHaveBeenCalledTimes(1);
  });

  it("while closed a store change neither redraws nor loads, and a click still loads the list", () => {
    const { settings, listMonitors, switchBtn } = build({ open: false });

    settings.setEnabled(true);
    expect(switchBtn.getAttribute("aria-checked")).toBe("false");
    expect(listMonitors).not.toHaveBeenCalled();

    settings.setEnabled(false);
    switchBtn.click();
    expect(settings.get().enabled).toBe(true);
    expect(listMonitors).toHaveBeenCalledTimes(1);
  });

  it("reflect() only redraws; loadMonitorsIfEnabled() lists the monitors only when enabled", () => {
    const off = build();
    off.section.loadMonitorsIfEnabled();
    expect(off.listMonitors).not.toHaveBeenCalled();

    const { listMonitors, section, switchBtn } = build({ enabled: true });

    section.reflect();
    expect(switchBtn.getAttribute("aria-checked")).toBe("true");
    expect(listMonitors).not.toHaveBeenCalled();

    section.loadMonitorsIfEnabled();
    expect(listMonitors).toHaveBeenCalledTimes(1);
  });

  it("after dispose() a store change does nothing and a click does not flip the store", () => {
    const { settings, listMonitors, section, switchBtn } = build();

    section.dispose();
    settings.setEnabled(true);
    expect(switchBtn.getAttribute("aria-checked")).toBe("false");
    expect(listMonitors).not.toHaveBeenCalled();

    settings.setEnabled(false);
    switchBtn.click();
    expect(settings.get().enabled).toBe(false);
  });
});
