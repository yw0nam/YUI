/**
 * browser-switch.test.ts — turning the browser switch off stops the owned Chrome.
 */

import { describe, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../settings/persisted-store";
import { stopBrowserWhenOff } from "./browser-switch";

describe("stopBrowserWhenOff", () => {
  it("stops the browser when the switch goes from on to off, and only then", () => {
    const settings = createFlagSettings(false);
    const shell = { stop: vi.fn(async () => {}) };
    const unsubscribe = stopBrowserWhenOff(settings, shell);

    settings.setEnabled(true);
    expect(shell.stop).not.toHaveBeenCalled();
    settings.setEnabled(false);
    expect(shell.stop).toHaveBeenCalledTimes(1);

    unsubscribe();
    settings.setEnabled(true);
    settings.setEnabled(false);
    expect(shell.stop).toHaveBeenCalledTimes(1);
  });
});
