/**
 * Monitor enumeration seam. The Tauri native implementation is swapped in later.
 * The browser only recognizes its own single screen.
 */

import type { ScreenSource } from "../contract";
import type { ScreenCapture } from "./screenshot-context";

export { isTauri } from "./tauri-env";

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

export function createBrowserScreenSourceProvider(screen?: {
  width: number;
  height: number;
}): ScreenSourceProvider {
  return {
    listMonitors(): Promise<MonitorInfo[]> {
      const src =
        screen ?? (typeof globalThis.screen !== "undefined" ? globalThis.screen : undefined);
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
