// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { createScreenKnobSettings } from "../../settings/capture/screen-settings";
import { createMessageWindowSettings } from "../../settings/panels/message-window-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createFillerSettings } from "../../settings/voice/filler-settings";
import { createSwitchRows, type SwitchRow } from "./switch-row";
import { bindSwitchRows, reflectSwitchRows } from "./switches/switch-rows";
import { buildPanelHtml } from "./template";

function makeSwitchRows(): SwitchRow[] {
  return createSwitchRows({
    idleThrottleSettings: createFlagSettings(true),
    ttsSettings: createFlagSettings(false),
    oneVoiceSettings: createFlagSettings(true),
    gazeSettings: createFlagSettings(true),
    climbSettings: createFlagSettings(true),
    fallSettings: createFlagSettings(true),
    agentNotifySettings: createAgentNotifySettings({
      storage: { load: () => ({ enabled: true, port: 8770 }), save: () => {} },
    }),
    fillerSettings: createFillerSettings({
      storage: {
        load: () => ({ enabled: false, language: "ja", customPools: {} }),
        save: () => {},
      },
    }),
    messageWindowSettings: createMessageWindowSettings(),
    screenSettings: createFlagSettings(false),
    screenKnobSettings: createScreenKnobSettings(),
    unifiedChatSwitch: createFlagSettings(false),
    relationsSwitch: createFlagSettings(true),
    threadReactionsSettings: createFlagSettings(true),
  });
}

function render(switchRows: readonly SwitchRow[], showThreadTurns = false): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    openOnQuickStart: false,
    switchRows,
    showScreen: true,
    showThreadTurns,
    showPresence: false,
    showPacerGap: false,
    showRateLimits: false,
    showHistory: false,
  });
  return root;
}

describe("SwitchRow descriptor", () => {
  // The message-window row renders only where a second window can exist.
  beforeEach(() => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("renders and reflects every visible, available descriptor entry", () => {
    // The Voice, Listening, Together and Motion pages render their rows in React, so the template holds the rest.
    const switchRows = makeSwitchRows()
      .filter(
        (row) =>
          row.isVisible &&
          row.tab !== "listening" &&
          row.tab !== "together" &&
          row.tab !== "motion" &&
          row.tab !== "voice",
      )
      .map((row, index) => ({
        ...row,
        initialEnabled: index % 2 !== 0,
        getEnabled: () => index % 2 === 0,
      }));
    const root = render(switchRows);

    for (const [index, row] of switchRows.entries()) {
      expect(root.querySelectorAll(row.selector)).toHaveLength(1);
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

  it("puts the Thread reactions row in the Threads group with Thread turns, on, and a click flips its store", () => {
    const threadReactionsSettings = createFlagSettings(true);
    const rows = createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      fillerSettings: createFillerSettings(),
      threadReactionsSettings,
    });
    const root = render(rows, true);
    const button = root.querySelector<HTMLButtonElement>(".yui-thread-reactions-switch");

    expect(button).not.toBeNull();
    expect(
      button!.closest(".yui-group")?.contains(root.querySelector(".yui-threadturns-row")),
    ).toBe(true);
    expect(button!.getAttribute("aria-checked")).toBe("true");

    const bound = bindSwitchRows(root, rows, { debug() {}, info() {}, warn() {}, error() {} });
    button!.click();
    expect(threadReactionsSettings.get().enabled).toBe(false);
    bound.dispose();
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
