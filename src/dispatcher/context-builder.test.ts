import { describe, expect, it, vi } from "vitest";
import type { InputContext } from "../contract";
import {
  ALL_CONTEXT_SIGNALS,
  buildClientContext,
  buildContext,
  type ContextPolicy,
} from "./context-builder";
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
        recent_apps: [{ name: "Terminal" }],
      },
      screenshot: {
        enabled: true,
        source: { kind: "monitor", index: 0 },
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

  it("caps active_window_title at 200 chars and marks the cut with an ellipsis", async () => {
    const long = "x".repeat(320);
    const built = await buildContext(
      ENV,
      { getOsContext: () => ({ activeWindowTitle: long }) },
      ALL_ON,
    );

    const expected = `${"x".repeat(199)}…`;
    expect(built.clientContext.env.active_window_title).toBe(expected);
    expect(built.clientContext.env.active_window_title).toHaveLength(200);
    expect(built.ctx.env.active_window_title).toBe(expected);
  });

  it("never leaves a lone surrogate at the truncation boundary", async () => {
    // 198 ASCII + astral chars puts the cut inside a surrogate pair.
    const long = `${"x".repeat(198)}${"\u{1F600}".repeat(20)}`;
    const built = await buildContext(
      ENV,
      { getOsContext: () => ({ activeWindowTitle: long }) },
      ALL_ON,
    );

    const title = built.clientContext.env.active_window_title!;
    expect(title).toBe(`${"x".repeat(198)}…`);
    // Strip well-formed pairs; any surrogate left over was unpaired.
    expect(/[\uD800-\uDFFF]/.test(title.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))).toBe(
      false,
    );
  });

  it("keeps a whole surrogate pair when the cut falls cleanly between characters", async () => {
    const long = `${"x".repeat(195)}${"\u{1F600}".repeat(20)}`;
    const built = await buildContext(
      ENV,
      { getOsContext: () => ({ activeWindowTitle: long }) },
      ALL_ON,
    );

    expect(built.clientContext.env.active_window_title).toBe(
      `${"x".repeat(195)}\u{1F600}\u{1F600}…`,
    );
  });

  it("keeps an active_window_title at or under 200 chars verbatim", async () => {
    const title = "y".repeat(200);
    const built = await buildContext(
      ENV,
      { getOsContext: () => ({ activeWindowTitle: title }) },
      ALL_ON,
    );

    expect(built.clientContext.env.active_window_title).toBe(title);
  });

  it("sends recent_apps as names only while peek still returns the timestamped entries", async () => {
    const peeked = [
      { name: "Slack", ts: 1_716_999_900_000 },
      { name: "Terminal", ts: 1_716_999_950_000 },
    ];
    const built = await buildContext(ENV, { peekRecentApps: () => peeked }, ALL_ON);

    expect(built.clientContext.env.recent_apps).toEqual([{ name: "Slack" }, { name: "Terminal" }]);
    expect(built.peekedApps).toEqual(peeked);
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

describe("buildClientContext — cue forwarding", () => {
  const CTX: InputContext = { env: { timestamp: "2026-07-31T14:22:33+09:00", timezone: "UTC" } };

  function cueEnv(payload: Record<string, unknown>): BusEnvelope {
    return {
      seq_id: 2,
      source: "os_event_watcher",
      event_name: "proactive.touch_chest",
      ts: 1_717_000_000_000,
      hint_tier: 2,
      payload,
    };
  }

  it("forwards a label-only cue without a context key", () => {
    const client = buildClientContext(CTX, cueEnv({ cue_id: "touch_chest", label: "chest poked" }));

    expect(client.trigger.cue).toEqual({ label: "chest poked" });
    expect("context" in client.trigger.cue!).toBe(false);
  });

  it("forwards context when the firing source supplied one", () => {
    const client = buildClientContext(
      CTX,
      cueEnv({ cue_id: "morning", label: "morning call", context: "say good morning" }),
    );

    expect(client.trigger.cue).toEqual({ label: "morning call", context: "say good morning" });
  });

  it("omits the cue when the payload carries no label", () => {
    const client = buildClientContext(CTX, cueEnv({ cue_id: "touch_chest" }));

    expect("cue" in client.trigger).toBe(false);
  });

  it("reduces screenshot meta to enabled + source", () => {
    const client = buildClientContext(
      {
        ...CTX,
        screenshot: {
          enabled: true,
          source: { kind: "monitor", index: 0 },
          data_url: "data:image/png;base64,SHOT",
          captured_at: "2026-07-31T14:22:33+09:00",
          width: 2560,
          height: 1440,
        },
      },
      cueEnv({}),
    );

    expect(client.screenshot).toEqual({ enabled: true, source: { kind: "monitor", index: 0 } });
  });
});
