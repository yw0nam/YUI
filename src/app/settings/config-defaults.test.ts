import { describe, expect, it } from "vitest";
import type { ConfigStore } from "../../config/store";
import { quickControlsConfigDefaults } from "./config-defaults";

const loaded = {
  get: () => ({
    guardrails: { rate_limit: { tier2_max: 7, overall_max: 9 } },
    screen: { settle_ms: 400 },
    endpoints: { chat_instructions: "be brief", chat_api: "push", chat_base_url: "http://x" },
    motions: {
      idle: { kind: "ambient" },
      wave: { kind: "gesture" },
      sway: { kind: "reactive" },
      hidden: { kind: "gesture", broker_publish: false },
    },
  }),
} as unknown as Pick<ConfigStore, "get">;

const unloaded = {
  get: () => {
    throw new Error("before load");
  },
} as Pick<ConfigStore, "get">;

describe("quickControlsConfigDefaults", () => {
  it("reads each default from the loaded config", () => {
    const d = quickControlsConfigDefaults(loaded);
    expect(d.getRateLimitDefaults()).toMatchObject({ tier2_max: 7, overall_max: 9 });
    expect(d.getScreenDefaults()).toMatchObject({ settle_ms: 400 });
    expect(d.getDefaultInstructions()).toBe("be brief");
    expect(d.getEndpointDefaults()).toMatchObject({ chat_base_url: "http://x" });
    expect(d.getDefaultChatApi()).toBe("push");
    expect(d.getIdlePool()).toEqual({ kind: "ambient" });
    expect(d.getExpressMotions()).toEqual(["wave"]);
  });

  it("falls back when the config has not loaded", () => {
    const d = quickControlsConfigDefaults(unloaded);
    expect(d.getRateLimitDefaults()).toBeUndefined();
    expect(d.getScreenDefaults()).toBeUndefined();
    expect(d.getDefaultInstructions()).toBeUndefined();
    expect(d.getEndpointDefaults()).toBeUndefined();
    expect(d.getDefaultChatApi()).toBeUndefined();
    expect(d.getIdlePool()).toBeUndefined();
    expect(d.getExpressMotions()).toEqual([]);
  });
});
