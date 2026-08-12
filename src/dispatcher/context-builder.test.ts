import { describe, expect, it, vi } from "vitest";
import type { InputContext } from "../contract";
import { buildClientContext, buildContext } from "./context-builder";
import type { BusEnvelope } from "./event-bus";

const ENV: BusEnvelope = {
  seq_id: 1,
  source: "user_input_source",
  event_name: "user.text",
  ts: 1_717_000_000_000,
  hint_tier: 3,
  payload: { text: "hello" },
};

describe("context builder", () => {
  it("builds env.timestamp/timezone and strips screenshot data from the wire shape", async () => {
    const built = await buildContext(ENV, {
      getScreenshot: async () => ({
        enabled: true,
        source: { kind: "monitor", index: 0 },
        data_url: "data:image/png;base64,SHOT",
      }),
    });

    expect(built.clientContext).toEqual({
      env: {
        timestamp: expect.any(String),
        timezone: expect.any(String),
      },
      screenshot: {
        enabled: true,
        source: { kind: "monitor", index: 0 },
      },
      trigger: { kind: "user" },
    });
    expect(built.ctx.screenshot?.data_url).toBe("data:image/png;base64,SHOT");
  });

  it("omits screenshot when the provider is absent", async () => {
    const built = await buildContext(ENV, {});
    expect(built.clientContext.screenshot).toBeUndefined();
  });

  it("omits screenshot when the provider resolves undefined", async () => {
    const built = await buildContext(ENV, { getScreenshot: async () => undefined });
    expect(built.clientContext.screenshot).toBeUndefined();
  });

  it("routes a screenshot provider error to onScreenshotError and still builds context", async () => {
    const onScreenshotError = vi.fn();
    const built = await buildContext(ENV, {
      getScreenshot: async () => {
        throw new Error("capture failed");
      },
      onScreenshotError,
    });

    expect(onScreenshotError).toHaveBeenCalledOnce();
    expect(built.clientContext.screenshot).toBeUndefined();
  });

  it("carries no active_app / active_window_title / posture / recent_apps fields", async () => {
    const built = await buildContext(ENV, {});
    expect(built.clientContext.env).not.toHaveProperty("active_app");
    expect(built.clientContext.env).not.toHaveProperty("active_window_title");
    expect(built.clientContext.env).not.toHaveProperty("posture");
    expect(built.clientContext.env).not.toHaveProperty("recent_apps");
  });

  it("carries the held body state from the provider", async () => {
    const built = await buildContext(ENV, {
      getBodyState: () => ({
        posture: { state: "sitting", perched_on: { app: "Notes" } },
        since: 1_716_999_000_000,
      }),
    });

    expect(built.clientContext.body_state).toEqual({
      posture: { state: "sitting", perched_on: { app: "Notes" } },
      since: 1_716_999_000_000,
    });
  });

  it("omits body_state when the provider reports no posture", async () => {
    const built = await buildContext(ENV, { getBodyState: () => undefined });
    expect(built.clientContext).not.toHaveProperty("body_state");
  });

  it("omits body_state when the provider is absent", async () => {
    const built = await buildContext(ENV, {});
    expect(built.clientContext).not.toHaveProperty("body_state");
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
        },
      },
      cueEnv({}),
    );

    expect(client.screenshot).toEqual({ enabled: true, source: { kind: "monitor", index: 0 } });
  });
});
