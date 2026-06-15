/**
 * tauri-screen.test.ts — Tauri-backed screen source provider + capturer.
 *
 * 검증:
 *  - createTauriScreenSourceProvider: DTO → MonitorInfo 매핑 (name null 시 label 폴백, primary 매핑)
 *  - createTauriScreenCapturer: capture_screen DTO → ScreenCapture 매핑 (data_url/width/height/captured_at)
 *  - createTauriScreenCapturer: invoke 호출 시 { index, maxEdge } 전달
 *  - createTauriScreenCapturer: kind !== "monitor" 소스면 null 반환 (invoke 미호출)
 *  - createTauriScreenCapturer: invoke reject 시 null 반환 (throw 안 함)
 */

import { describe, expect, it, vi } from "vitest";
import type { ScreenSource } from "../contract";
import { createTauriScreenCapturer, createTauriScreenSourceProvider } from "./tauri-screen";

// ─── createTauriScreenSourceProvider ──────────────────────────────────────────

describe("createTauriScreenSourceProvider — DTO mapping", () => {
  it("maps a single DTO with name to MonitorInfo", async () => {
    const fakeInvoke = vi.fn().mockResolvedValue([
      {
        index: 0,
        name: "Built-in Retina Display",
        width: 2560,
        height: 1600,
        isPrimary: true,
        x: 0,
        y: 0,
      },
    ]);
    const provider = createTauriScreenSourceProvider(fakeInvoke);
    const monitors = await provider.listMonitors();
    expect(fakeInvoke).toHaveBeenCalledWith("list_screen_sources");
    expect(monitors).toHaveLength(1);
    expect(monitors[0]).toEqual({
      index: 0,
      label: "Built-in Retina Display",
      width: 2560,
      height: 1600,
      primary: true,
    });
  });

  it("uses fallback label '디스플레이 N+1' when name is null", async () => {
    const fakeInvoke = vi.fn().mockResolvedValue([
      { index: 0, name: null, width: 1920, height: 1080, isPrimary: true, x: 0, y: 0 },
      { index: 1, name: null, width: 2560, height: 1440, isPrimary: false, x: 1920, y: 0 },
    ]);
    const provider = createTauriScreenSourceProvider(fakeInvoke);
    const monitors = await provider.listMonitors();
    expect(monitors[0].label).toBe("디스플레이 1");
    expect(monitors[1].label).toBe("디스플레이 2");
  });

  it("maps isPrimary to primary field", async () => {
    const fakeInvoke = vi.fn().mockResolvedValue([
      { index: 0, name: "Primary", width: 1920, height: 1080, isPrimary: true, x: 0, y: 0 },
      { index: 1, name: "Secondary", width: 1920, height: 1080, isPrimary: false, x: 1920, y: 0 },
    ]);
    const provider = createTauriScreenSourceProvider(fakeInvoke);
    const monitors = await provider.listMonitors();
    expect(monitors[0].primary).toBe(true);
    expect(monitors[1].primary).toBe(false);
  });

  it("maps width and height from DTO", async () => {
    const fakeInvoke = vi
      .fn()
      .mockResolvedValue([
        { index: 2, name: "External", width: 3840, height: 2160, isPrimary: false, x: 0, y: 0 },
      ]);
    const provider = createTauriScreenSourceProvider(fakeInvoke);
    const monitors = await provider.listMonitors();
    expect(monitors[0].width).toBe(3840);
    expect(monitors[0].height).toBe(2160);
    expect(monitors[0].index).toBe(2);
  });
});

// ─── createTauriScreenCapturer ────────────────────────────────────────────────

describe("createTauriScreenCapturer — monitor source", () => {
  it("maps capture_screen DTO to ScreenCapture", async () => {
    const fakeInvoke = vi.fn().mockResolvedValue({
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      width: 1280,
      height: 800,
    });
    const capturer = createTauriScreenCapturer(1280, fakeInvoke);
    const source: ScreenSource = { kind: "monitor", index: 0 };
    const result = await capturer.capture(source);
    expect(result).not.toBeNull();
    expect(result!.data_url).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(result!.width).toBe(1280);
    expect(result!.height).toBe(800);
    expect(typeof result!.captured_at).toBe("string");
    expect(result!.captured_at.length).toBeGreaterThan(0);
  });

  it("calls invoke with { index, maxEdge } matching the source and config", async () => {
    const fakeInvoke = vi.fn().mockResolvedValue({
      dataUrl: "data:image/png;base64,abc",
      width: 640,
      height: 400,
    });
    const capturer = createTauriScreenCapturer(960, fakeInvoke);
    const source: ScreenSource = { kind: "monitor", index: 3 };
    await capturer.capture(source);
    expect(fakeInvoke).toHaveBeenCalledWith("capture_screen", { index: 3, maxEdge: 960 });
  });

  it("uses default maxEdge of 1280 when not specified", async () => {
    const fakeInvoke = vi.fn().mockResolvedValue({
      dataUrl: "data:image/png;base64,def",
      width: 1280,
      height: 720,
    });
    const capturer = createTauriScreenCapturer(undefined, fakeInvoke);
    const source: ScreenSource = { kind: "monitor", index: 0 };
    await capturer.capture(source);
    expect(fakeInvoke).toHaveBeenCalledWith("capture_screen", { index: 0, maxEdge: 1280 });
  });
});

describe("createTauriScreenCapturer — non-monitor source", () => {
  it("returns null for browser_tab source without calling invoke", async () => {
    const fakeInvoke = vi.fn();
    const capturer = createTauriScreenCapturer(1280, fakeInvoke);
    const source: ScreenSource = { kind: "browser_tab", browser: "Chrome", tab_title: "Google" };
    const result = await capturer.capture(source);
    expect(result).toBeNull();
    expect(fakeInvoke).not.toHaveBeenCalled();
  });

  it("returns null for window source without calling invoke", async () => {
    const fakeInvoke = vi.fn();
    const capturer = createTauriScreenCapturer(1280, fakeInvoke);
    const source: ScreenSource = { kind: "window", app: "Finder", window_title: "Downloads" };
    const result = await capturer.capture(source);
    expect(result).toBeNull();
    expect(fakeInvoke).not.toHaveBeenCalled();
  });
});

describe("createTauriScreenCapturer — invoke failure", () => {
  it("returns null when invoke rejects (never throws)", async () => {
    const fakeInvoke = vi.fn().mockRejectedValue(new Error("capture permission denied"));
    const capturer = createTauriScreenCapturer(1280, fakeInvoke);
    const source: ScreenSource = { kind: "monitor", index: 0 };
    const result = await capturer.capture(source);
    expect(result).toBeNull();
  });

  it("does not propagate the error from invoke rejection", async () => {
    const fakeInvoke = vi.fn().mockRejectedValue(new Error("screen record permission denied"));
    const capturer = createTauriScreenCapturer(1280, fakeInvoke);
    const source: ScreenSource = { kind: "monitor", index: 1 };
    await expect(capturer.capture(source)).resolves.toBeNull();
  });
});
