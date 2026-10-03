import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../ui/i18n";
import { wireCueLocaleSync } from "./wire-cue-locale-sync";

const unsubscribe = vi.fn();
let listener: ((locale: Locale) => void) | undefined;

vi.mock("../../ui/i18n", () => ({
  getLocale: vi.fn(() => "en"),
  subscribe: vi.fn((fn: (locale: Locale) => void) => {
    listener = fn;
    return unsubscribe;
  }),
}));

describe("wireCueLocaleSync", () => {
  beforeEach(() => {
    listener = undefined;
    unsubscribe.mockClear();
  });

  it("syncs both cue stores to the current locale at wiring time and on each change", () => {
    const proactiveSettings = { syncLocale: vi.fn() };
    const scheduleSettings = { syncLocale: vi.fn() };
    const dispose = wireCueLocaleSync({ proactiveSettings, scheduleSettings });

    expect(proactiveSettings.syncLocale).toHaveBeenCalledWith("en");
    expect(scheduleSettings.syncLocale).toHaveBeenCalledWith("en");

    listener?.("ja");

    expect(proactiveSettings.syncLocale).toHaveBeenLastCalledWith("ja");
    expect(scheduleSettings.syncLocale).toHaveBeenLastCalledWith("ja");
    expect(proactiveSettings.syncLocale).toHaveBeenCalledTimes(2);
    expect(scheduleSettings.syncLocale).toHaveBeenCalledTimes(2);
    dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
