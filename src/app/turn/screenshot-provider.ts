/** Captures the turn's screenshot — only for a backend that takes images with its turns. */

import type { InputContext } from "../../contract";
import type { ScreenCapturer } from "../../io/window/capture/screen-source-provider";
import { buildScreenshotBlock } from "../../io/window/capture/screenshot-context";
import type { ScreenshotSettings } from "../../settings/capture/screenshot-settings";

export interface ScreenshotProviderDeps {
  screenshotSettings: { get(): ScreenshotSettings };
  screenCapturer: ScreenCapturer;
  /** False on a backend that takes no images on a turn; no capture happens at all then. */
  acceptsImages: () => boolean;
}

export function createScreenshotProvider(
  deps: ScreenshotProviderDeps,
): () => Promise<InputContext["screenshot"] | undefined> {
  return async () => {
    if (!deps.acceptsImages()) return undefined;
    const screenshot = deps.screenshotSettings.get();
    if (!screenshot.enabled) return undefined;
    const capture = await deps.screenCapturer.capture(screenshot.source);
    return buildScreenshotBlock(screenshot, capture ?? undefined);
  };
}
