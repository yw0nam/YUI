/**
 * Pure encoder for InputContext["screenshot"] block.
 * Actual screen capture is outside this module's scope — native capture layer fills ScreenCapture.
 */

import type { InputContext } from "../../../contract";
import type { ScreenshotSettings } from "../../../settings/capture/screenshot-settings";

export interface ScreenCapture {
  data_url: string;
}

export function buildScreenshotBlock(
  settings: ScreenshotSettings,
  capture?: ScreenCapture,
): InputContext["screenshot"] | undefined {
  if (!settings.enabled) return undefined;

  if (!capture) {
    return { enabled: true, source: settings.source };
  }

  return { enabled: true, source: settings.source, data_url: capture.data_url };
}
