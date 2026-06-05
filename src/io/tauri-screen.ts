/**
 * Tauri-backed 화면 열거 + 캡처 구현, 그리고 환경별 selector.
 * invoke는 테스트 주입 가능(기본값은 @tauri-apps/api/core 실제 invoke).
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { ScreenSource } from "../contract";
import type { ScreenCapture } from "./screenshot-context";
import {
  type ScreenSourceProvider,
  type ScreenCapturer,
  type MonitorInfo,
  isTauri,
  noopScreenCapturer,
  createBrowserScreenSourceProvider,
} from "./screen-source-provider";

// ─── DTO types ────────────────────────────────────────────────────────────────

interface ScreenSourceDto {
  index: number;
  name: string | null;
  width: number;
  height: number;
  isPrimary: boolean;
}

interface CaptureDto {
  dataUrl: string;
  width: number;
  height: number;
}

// ─── Injectable invoke signature ──────────────────────────────────────────────

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

// ─── Tauri screen source provider ────────────────────────────────────────────

export function createTauriScreenSourceProvider(invoke: InvokeFn = tauriInvoke): ScreenSourceProvider {
  return {
    async listMonitors(): Promise<MonitorInfo[]> {
      const dtos = await invoke<ScreenSourceDto[]>("list_screen_sources");
      return dtos.map((dto) => ({
        index: dto.index,
        label: dto.name ?? `디스플레이 ${dto.index + 1}`,
        width: dto.width,
        height: dto.height,
        primary: dto.isPrimary,
      }));
    },
  };
}

// ─── Tauri screen capturer ────────────────────────────────────────────────────

export function createTauriScreenCapturer(maxEdge = 1280, invoke: InvokeFn = tauriInvoke): ScreenCapturer {
  return {
    async capture(source: ScreenSource): Promise<ScreenCapture | null> {
      if (source.kind !== "monitor") return null;
      try {
        const dto = await invoke<CaptureDto>("capture_screen", { index: source.index, maxEdge });
        return {
          data_url: dto.dataUrl,
          captured_at: new Date().toISOString(),
          width: dto.width,
          height: dto.height,
        };
      } catch (err) {
        console.error("[YUI] screen capture failed:", err);
        return null;
      }
    },
  };
}

// ─── Environment selectors ────────────────────────────────────────────────────

export function resolveScreenSourceProvider(): ScreenSourceProvider {
  return isTauri() ? createTauriScreenSourceProvider() : createBrowserScreenSourceProvider();
}

export function resolveScreenCapturer(): ScreenCapturer {
  return isTauri() ? createTauriScreenCapturer() : noopScreenCapturer;
}
