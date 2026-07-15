/**
 * screenshot-context.test.ts — buildScreenshotBlock pure encoder.
 *
 * Verify:
 *  - enabled=false → undefined
 *  - enabled=true, no capture → {enabled:true, source}
 *  - enabled=true, with capture → {enabled:true, source, data_url, captured_at, width, height}
 */

import { describe, expect, it } from "vitest";
import { buildScreenshotBlock, type ScreenCapture } from "./screenshot-context";
import type { ScreenshotSettings } from "./screenshot-settings";

const BASE_SOURCE = { kind: "monitor" as const, index: 0 };

describe("buildScreenshotBlock — disabled", () => {
  it("returns undefined when enabled=false regardless of capture", () => {
    const settings: ScreenshotSettings = { enabled: false, source: BASE_SOURCE };
    expect(buildScreenshotBlock(settings)).toBeUndefined();
    const capture: ScreenCapture = {
      data_url: "data:image/png;base64,abc",
      captured_at: "2026-06-05T00:00:00.000Z",
      width: 1920,
      height: 1080,
    };
    expect(buildScreenshotBlock(settings, capture)).toBeUndefined();
  });
});

describe("buildScreenshotBlock — enabled, no capture", () => {
  it("returns {enabled:true, source} with no image fields", () => {
    const settings: ScreenshotSettings = {
      enabled: true,
      source: { kind: "monitor", index: 1, label: "메인" },
    };
    const result = buildScreenshotBlock(settings);
    expect(result).toEqual({ enabled: true, source: settings.source });
  });
});

describe("buildScreenshotBlock — enabled, with capture", () => {
  it("returns full block including all capture fields", () => {
    const settings: ScreenshotSettings = {
      enabled: true,
      source: { kind: "monitor", index: 0 },
    };
    const capture: ScreenCapture = {
      data_url: "data:image/png;base64,xyz",
      captured_at: "2026-06-05T12:34:56.789Z",
      width: 2560,
      height: 1440,
    };
    const result = buildScreenshotBlock(settings, capture);
    expect(result).toEqual({
      enabled: true,
      source: settings.source,
      data_url: capture.data_url,
      captured_at: capture.captured_at,
      width: capture.width,
      height: capture.height,
    });
  });

  it("source in result matches settings.source (not mutated)", () => {
    const source = { kind: "monitor" as const, index: 2, label: "외부" };
    const settings: ScreenshotSettings = { enabled: true, source };
    const capture: ScreenCapture = {
      data_url: "data:image/png;base64,test",
      captured_at: "2026-06-05T00:00:00.000Z",
      width: 1280,
      height: 720,
    };
    const result = buildScreenshotBlock(settings, capture);
    expect(result?.source).toEqual(source);
  });
});
