/**
 * InputContext["screenshot"] 블록을 구성하는 순수 인코더.
 * 실제 화면 캡처는 이 모듈의 범위 밖이다 — 네이티브 캡처 레이어가 ScreenCapture를 채운다.
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

  return {
    enabled: true,
    source: settings.source,
    data_url: capture.data_url,
    captured_at: capture.captured_at,
    width: capture.width,
    height: capture.height,
  };
}
