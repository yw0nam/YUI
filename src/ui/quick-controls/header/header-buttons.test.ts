// @vitest-environment jsdom
/**
 * header-buttons.test.ts — the popover header's pop-out, message, devtools and close buttons on the
 * panel's real markup: each click's callback, the message button's close-first order, and teardown.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../../settings/persisted-store";
import { createVadSettings } from "../../../settings/voice/vad-settings";
import { setLocale } from "../../i18n";
import { createSwitchRows } from "../switch-row";
import { buildPanelHtml } from "../template";
import { createHeaderButtons } from "./header-buttons";

function build() {
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
    showDevtools: true,
    showHelp: false,
    showMessage: true,
    showHistory: false,
  });
  document.body.append(root);
  const calls: string[] = [];
  const buttons = createHeaderButtons({
    root,
    close: () => calls.push("close"),
    onPopOut: () => calls.push("popOut"),
    onMessage: () => calls.push("message"),
    onOpenDevtools: () => calls.push("devtools"),
  });
  const click = (selector: string): void =>
    root.querySelector<HTMLButtonElement>(selector)!.click();
  return { calls, buttons, click };
}

describe("createHeaderButtons", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
    vi.restoreAllMocks();
  });

  it("each click calls its callback, and the message button closes before it opens the input", () => {
    const { calls, click } = build();

    click(".yui-iconbtn--popout");
    click(".yui-devtools-open");
    click(".yui-iconbtn--close");
    expect(calls).toEqual(["popOut", "devtools", "close"]);

    calls.length = 0;
    click(".yui-iconbtn--message");
    expect(calls).toEqual(["close", "message"]);
  });

  it("after dispose() the pop-out, message and close clicks do nothing and devtools still opens", () => {
    const { calls, buttons, click } = build();

    buttons.dispose();
    click(".yui-iconbtn--popout");
    click(".yui-iconbtn--message");
    click(".yui-iconbtn--close");
    click(".yui-devtools-open");

    expect(calls).toEqual(["devtools"]);
  });
});
