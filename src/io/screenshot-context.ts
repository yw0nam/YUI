/**
 * Pure encoder for InputContext["screenshot"] block.
 * Actual screen capture is outside this module's scope — native capture layer fills ScreenCapture.
 */

import type { InputContext } from "../contract";
import type { ScreenshotSettings } from "./screenshot-settings";

export interface ScreenCapture {
  data_url: string;
  captured_at: string;
  width: number;
  height: number;
}

export function buildScreenshotBlock(
  settings: ScreenshotSettings,
  capture?: ScreenCapture,
): InputContext["screenshot"] | undefined {
  if (!settings.enabled) return undefined;

  if (!capture) {
    return { enabled: true, source: settings.source };
  }

  // Only the pixels ride along — the capture's timestamp and dimensions have no reader.
  return { enabled: true, source: settings.source, data_url: capture.data_url };
}
