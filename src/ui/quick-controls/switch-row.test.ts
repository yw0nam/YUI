// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import { createScreenKnobSettings } from "../../settings/capture/screen-settings";
import { createMessageWindowSettings } from "../../settings/panels/message-window-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createFillerSettings } from "../../settings/voice/filler-settings";
import { createVadSettings } from "../../settings/voice/vad-settings";
import { createSwitchRows, type SwitchRow } from "./switch-row";
import { bindSwitchRows, reflectSwitchRows } from "./switches/switch-rows";
import { buildPanelHtml } from "./template";

function makeSwitchRows(): SwitchRow[] {
  return createSwitchRows({
    idleThrottleSettings: createFlagSettings(true),
    ttsSettings: createFlagSettings(false),
    oneVoiceSettings: createFlagSettings(true),
    vad: createVadSettings(),
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
    bubblePersistSettings: createFlagSettings(false),
    messageWindowSettings: createMessageWindowSettings(),
    screenSettings: createFlagSettings(false),
    screenKnobSettings: createScreenKnobSettings(),
    unifiedChatSwitch: createFlagSettings(false),
    relationsSwitch: createFlagSettings(true),
  });
}

function render(switchRows: readonly SwitchRow[]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    isWindow: false,
    hasSession: false,
    switchRows,
    showScreen: true,
    showPresence: false,
    showPacerGap: false,
    showRateLimits: false,
    showDevtools: false,
    showHelp: false,
    showMessage: false,
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

  it("puts the Unified chat row in the Together page, off, and a click flips its store", () => {
    const unifiedChatSwitch = createFlagSettings(false);
    const rows = createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      vad: createVadSettings(),
      fillerSettings: createFillerSettings(),
      unifiedChatSwitch,
    });
    const root = render(rows);
    const button = root.querySelector<HTMLButtonElement>(".yui-unified-switch");

    expect(button?.closest("[role=tabpanel]")?.id).toBe("yui-panel-together");
    expect(button?.getAttribute("aria-checked")).toBe("false");

    const bound = bindSwitchRows(root, rows, { debug() {}, info() {}, warn() {}, error() {} });
    button?.click();
    expect(unifiedChatSwitch.get().enabled).toBe(true);
    bound.dispose();
  });

  it("locks the message window row with its reason while the unified window shows", () => {
    const messageWindowSettings = createMessageWindowSettings();
    let shown = true;
    const listeners = new Set<(shown: boolean) => void>();
    const rows = createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      vad: createVadSettings(),
      fillerSettings: createFillerSettings(),
      messageWindowSettings,
      unifiedShown: {
        get: () => shown,
        subscribe: (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      },
    });
    const root = render(rows);
    const bound = bindSwitchRows(
      root,
      rows,
      { debug() {}, info() {}, warn() {}, error() {} },
      () => true,
    );
    const button = root.querySelector<HTMLButtonElement>(".yui-message-window-switch")!;
    const sub = () => button.closest(".yui-row")?.querySelector(".yui-row__sub")?.textContent;
    bound.reflect();

    expect(button.disabled).toBe(true);
    expect(sub()).toBe("Off while the unified chat window shows");
    button.click();
    expect(messageWindowSettings.get().mode).toBe("docked");

    shown = false;
    for (const cb of listeners) cb(false);

    expect(button.disabled).toBe(false);
    expect(sub()).toBe("Speech and typing live in a window you can drag anywhere");
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
