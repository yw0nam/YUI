/** screenshot-provider.test.ts — the turn's screenshot is captured only for a backend that takes images. */

import { describe, expect, it, vi } from "vitest";
import type { ScreenshotSettings } from "../../settings/capture/screenshot-settings";
import { createScreenshotProvider } from "./screenshot-provider";

const SETTINGS: ScreenshotSettings = { enabled: true, source: { kind: "monitor", index: 0 } };

describe("createScreenshotProvider", () => {
  it("captures nothing when the backend takes no images", async () => {
    const capture = vi.fn();
    const getScreenshot = createScreenshotProvider({
      screenshotSettings: { get: () => SETTINGS },
      screenCapturer: { capture },
      acceptsImages: () => false,
    });

    expect(await getScreenshot()).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });

  it("captures and builds the block when the backend takes images", async () => {
    const block = {
      enabled: true,
      source: { kind: "monitor", index: 0 },
      data_url: "data:image/png;base64,AAA",
    };
    const getScreenshot = createScreenshotProvider({
      screenshotSettings: { get: () => SETTINGS },
      screenCapturer: { capture: async () => ({ data_url: "data:image/png;base64,AAA" }) },
      acceptsImages: () => true,
    });

    expect(await getScreenshot()).toEqual(block);
  });
});
