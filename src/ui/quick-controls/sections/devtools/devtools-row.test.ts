// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createFillerSettings } from "../../../../settings/voice/filler-settings";
import { createVadSettings } from "../../../../settings/voice/vad-settings";
import { createSwitchRows } from "../../switch-row";
import { buildPanelHtml } from "../../template";
import { bindDevtoolsRow } from "./devtools-row";

function build() {
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    isWindow: true,
    hasSession: false,
    switchRows: createSwitchRows({
      idleThrottleSettings: createFlagSettings(false),
      vad: createVadSettings(),
      fillerSettings: createFillerSettings(),
    }),
    showScreen: false,
    showPresence: false,
    showPacerGap: false,
    showRateLimits: false,
    showDevtools: true,
    showHelp: false,
    showMessage: false,
    showHistory: false,
  });
  document.body.append(root);
  const open = vi.fn();
  const unbind = bindDevtoolsRow(root, open);
  return { root, open, unbind };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("opens Developer Tools from the row on the General page", () => {
  const { root, open } = build();

  root.querySelector<HTMLButtonElement>("#yui-panel-general .yui-devtools-open")!.click();

  expect(open).toHaveBeenCalledOnce();
});

it("stops opening after the binding is removed", () => {
  const { root, open, unbind } = build();

  unbind();
  root.querySelector<HTMLButtonElement>(".yui-devtools-open")!.click();

  expect(open).not.toHaveBeenCalled();
});
