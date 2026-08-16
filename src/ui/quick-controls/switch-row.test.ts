// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../io/agent-notify-settings";
import { createFillerSettings } from "../../io/filler-settings";
import { createFlagSettings } from "../../io/persisted-store";
import { createScreenKnobSettings } from "../../io/screen-settings";
import { createVadSettings } from "../../io/vad-settings";
import { createSwitchRows } from "../quick-controls";
import { reflectSwitchRows } from "./reflect";
import type { SwitchRow } from "./switch-row";
import { buildPanelHtml } from "./template";

function makeSwitchRows(): SwitchRow[] {
  return createSwitchRows({
    idleThrottleSettings: createFlagSettings(true),
    ttsSettings: createFlagSettings(false),
    vad: createVadSettings(),
    gazeSettings: createFlagSettings(true),
    agentNotifySettings: createAgentNotifySettings({ initial: { enabled: true, port: 8770 } }),
    fillerSettings: createFillerSettings({
      initial: { enabled: false, language: "ja", customPools: {} },
    }),
    bubblePersistSettings: createFlagSettings(false),
    screenSettings: createFlagSettings(false),
    screenKnobSettings: createScreenKnobSettings(),
  });
}

function render(switchRows: readonly SwitchRow[]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    isWindow: false,
    hasSession: false,
    showSessionReset: false,
    showViewpoint: false,
    showIdleMotion: false,
    showExpressMotion: false,
    switchRows,
    showScreen: true,
    showPresence: false,
    showRateLimits: false,
    showDevtools: false,
    showHistory: false,
    railCollapsed: false,
  });
  return root;
}

describe("SwitchRow descriptor", () => {
  it("renders and reflects every visible, available descriptor entry", () => {
    const switchRows = makeSwitchRows().map((row, index) => ({
      ...row,
      initialEnabled: index % 2 !== 0,
      getEnabled: () => index % 2 === 0,
    }));
    const root = render(switchRows);

    for (const [index, row] of switchRows.entries()) {
      expect(root.querySelectorAll(row.selector)).toHaveLength(1);
      expect(row.isVisible).toBe(true);
      expect(row.isAvailable).toBe(true);
      expect(root.querySelector(row.selector)?.getAttribute("aria-checked")).not.toBe(
        String(index % 2 === 0),
      );
    }

    reflectSwitchRows(root, switchRows);

    for (const [index, row] of switchRows.entries()) {
      expect(root.querySelector(row.selector)?.getAttribute("aria-checked")).toBe(
        String(index % 2 === 0),
      );
    }
  });

  it("omits an invisible, unavailable row and skips reflection", () => {
    const getEnabled = vi.fn(() => true);
    const hiddenRow: SwitchRow = {
      ...makeSwitchRows()[0],
      isVisible: false,
      isAvailable: false,
      getEnabled,
    };
    const root = render([hiddenRow]);

    expect(root.querySelector(hiddenRow.selector)).toBeNull();
    expect(() => reflectSwitchRows(root, [hiddenRow])).not.toThrow();
    expect(getEnabled).not.toHaveBeenCalled();
  });
});
