/**
 * The pill's Open mic settings action: it opens the macOS microphone privacy pane through the
 * opener plugin, and is offered only to the desktop app on macOS.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { micSettingsOpener, openMicSettings } from "./open-mic-settings";

describe("openMicSettings", () => {
  beforeEach(() => invoke.mockResolvedValue(undefined));

  it("opens the Microphone privacy pane and nothing else", () => {
    openMicSettings();

    expect(invoke).toHaveBeenCalledExactlyOnceWith("plugin:opener|open_url", {
      url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    });
  });
});

describe("micSettingsOpener", () => {
  it.each([[{ tauri: true, mac: true }, true]])("for %j is %s", (env, offered) => {
    expect(micSettingsOpener(env)).toBe(offered ? openMicSettings : undefined);
  });
});
