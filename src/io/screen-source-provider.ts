/**
 * 모니터 열거 seam. Tauri 네이티브 구현은 나중에 교체한다.
 * 브라우저는 자신의 화면 하나만 인식한다.
 */

import type { ScreenSource } from "../contract";
import type { ScreenCapture } from "./screenshot-context";

export interface MonitorInfo {
  index: number;
  label?: string;
  width?: number;
  height?: number;
  primary?: boolean;
}

export interface ScreenSourceProvider {
  listMonitors(): Promise<MonitorInfo[]>;
}

export interface ScreenCapturer {
  capture(source: ScreenSource): Promise<ScreenCapture | null>;
}

export const noopScreenCapturer: ScreenCapturer = {
  capture(_source: ScreenSource): Promise<ScreenCapture | null> {
    return Promise.resolve(null);
  },
};

export function isTauri(): boolean {
  return !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export function createBrowserScreenSourceProvider(
  screen?: { width: number; height: number },
): ScreenSourceProvider {
  return {
    listMonitors(): Promise<MonitorInfo[]> {
      const src = screen ?? (typeof globalThis.screen !== "undefined" ? globalThis.screen : undefined);
      const monitor: MonitorInfo = {
        index: 0,
        label: "이 화면",
        primary: true,
      };
      if (src) {
        monitor.width = src.width;
        monitor.height = src.height;
      }
      return Promise.resolve([monitor]);
    },
  };
}
