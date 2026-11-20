/** Opens the macOS Microphone privacy pane, where the user allows YUI after a blocked mic. */

import { invoke } from "@tauri-apps/api/core";
import { createLogger } from "../../logger";

const log = createLogger("open-mic-settings");

// The one URL the pet window's capability lets the opener plugin open besides web links.
const MIC_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

export function openMicSettings(): void {
  invoke("plugin:opener|open_url", { url: MIC_SETTINGS_URL }).catch((err) =>
    log.warn("open_failed", { error: String(err) }),
  );
}

/** The opener for the pill, or undefined where the pane does not exist: outside the desktop app or off macOS. */
export function micSettingsOpener(env: { tauri: boolean; mac: boolean }): (() => void) | undefined {
  return env.tauri && env.mac ? openMicSettings : undefined;
}
