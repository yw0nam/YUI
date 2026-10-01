import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_API_KEY_SECRET } from "../../config/load";
import { devKeyFallback } from "./dev-key-fallback";

describe("devKeyFallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("carries no key when DEV is false", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_YUI_CHAT_KEY", "sentinel-7731");

    expect(devKeyFallback()).toEqual({});
    expect(devKeyFallback()[CHAT_API_KEY_SECRET]).toBeUndefined();
  });

  it("reads the env keys in a dev build", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_YUI_CHAT_KEY", "dev-key");

    expect(devKeyFallback()[CHAT_API_KEY_SECRET]).toBe("dev-key");
  });
});
