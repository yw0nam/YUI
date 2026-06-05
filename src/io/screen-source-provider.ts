/**
 * 모니터 열거 seam. Tauri 네이티브 구현은 나중에 교체한다.
 * 브라우저는 자신의 화면 하나만 인식한다.
 */

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
