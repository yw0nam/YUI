import { describe, expect, it, vi } from "vitest";
import { ALL_CONTEXT_SIGNALS, buildContext, type ContextPolicy } from "./context-builder";
import type { BusEnvelope } from "./event-bus";

const ENV: BusEnvelope = {
  seq_id: 1,
  source: "user_input_source",
  event_name: "user.text",
  ts: 1_717_000_000_000,
  hint_tier: 3,
  payload: { text: "hello" },
};

const ALL_ON: ContextPolicy = {
  recent_apps: true,
  active_app: true,
  active_window_title: true,
  posture: true,
  screenshot: true,
};

describe("context builder", () => {
  it("preserves the existing all-signals wire shape and strips screenshot data", async () => {
    const built = await buildContext(
      ENV,
      {
        getOsContext: () => ({
          activeApp: "Visual Studio Code",
          activeWindowTitle: "context-builder.ts",
        }),
        getPosture: () => ({ state: "sitting" }),
        peekRecentApps: () => [{ name: "Terminal", ts: 1_716_999_900_000 }],
        getScreenshot: async () => ({
          enabled: true,
          source: { kind: "monitor", index: 0 },
          data_url: "data:image/png;base64,SHOT",
          captured_at: "2024-05-29T00:00:00Z",
          width: 1280,
          height: 720,
        }),
      },
      ALL_ON,
    );

    expect(built.clientContext).toEqual({
      env: {
        timestamp: expect.any(String),
        timezone: expect.any(String),
        active_app: { name: "Visual Studio Code" },
        active_window_title: "context-builder.ts",
        posture: { state: "sitting" },
        recent_apps: [{ name: "Terminal", at: expect.any(String) }],
      },
      screenshot: {
        enabled: true,
        source: { kind: "monitor", index: 0 },
        captured_at: "2024-05-29T00:00:00Z",
        width: 1280,
        height: 720,
      },
      trigger: { kind: "user" },
    });
    expect(built.record).toEqual({ included: [...ALL_CONTEXT_SIGNALS], excluded: [] });
    expect(built.ctx.screenshot?.data_url).toBe("data:image/png;base64,SHOT");
  });

  it("omits disabled signals, records them as excluded, and skips dedicated providers", async () => {
    const getOsContext = vi.fn(() => ({
      activeApp: "Terminal",
      activeWindowTitle: "shell",
    }));
    const getPosture = vi.fn(() => ({ state: "dragging" as const }));
    const peekRecentApps = vi.fn(() => [{ name: "Browser", ts: ENV.ts }]);
    const getScreenshot = vi.fn(async () => ({
      enabled: true,
      source: { kind: "monitor" as const, index: 0 },
    }));

    const built = await buildContext(
      ENV,
      { getOsContext, getPosture, peekRecentApps, getScreenshot },
      {
        recent_apps: false,
        active_app: false,
        active_window_title: true,
        posture: false,
        screenshot: false,
      },
    );

    expect(getOsContext).toHaveBeenCalledOnce();
    expect(getPosture).not.toHaveBeenCalled();
    expect(peekRecentApps).not.toHaveBeenCalled();
    expect(getScreenshot).not.toHaveBeenCalled();
    expect(built.clientContext.env).toMatchObject({ active_window_title: "shell" });
    expect(built.clientContext.env).not.toHaveProperty("active_app");
    expect(built.record).toEqual({
      included: ["active_window_title"],
      excluded: ["active_app", "posture", "recent_apps", "screenshot"],
    });
    expect(built.peekedApps).toEqual([]);
  });

  it("skips the shared OS snapshot only when both OS fields are disabled", async () => {
    const getOsContext = vi.fn(() => ({ activeApp: "Terminal", activeWindowTitle: "shell" }));
    const built = await buildContext(
      ENV,
      { getOsContext },
      {
        ...ALL_ON,
        active_app: false,
        active_window_title: false,
      },
    );

    expect(getOsContext).not.toHaveBeenCalled();
    expect(built.record.excluded).toEqual(["active_app", "active_window_title"]);
  });

  it("does not record enabled signals when their providers have no data", async () => {
    const built = await buildContext(
      ENV,
      {
        getOsContext: () => ({}),
        getPosture: () => undefined,
        peekRecentApps: () => [],
        getScreenshot: async () => undefined,
      },
      ALL_ON,
    );

    expect(built.record).toEqual({ included: [], excluded: [] });
  });
});
