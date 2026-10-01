import { describe, expect, it } from "vitest";
import type { EndpointsConfig } from "../../../contract";
import { pushOnlyEndpoints } from "./push-only";

const base = (patch: Partial<EndpointsConfig> = {}): EndpointsConfig => ({
  chat_base_url: "ws://gateway.test",
  stt_base_url: "",
  tts_base_url: "",
  chat_api: "responses",
  ...patch,
});

describe("pushOnlyEndpoints", () => {
  it("returns chat_api push whatever the underlying accessor says", () => {
    const get = pushOnlyEndpoints(() => base({ chat_api: "chat_completions" }));
    expect(get().chat_api).toBe("push");
  });

  it("keeps push after a chat-section reset clears the store's override", () => {
    // A reset rewrites the override store; the accessor merges it back over the bundled config —
    // neither is the source, so the wrapped accessor cannot observe it.
    let stored: EndpointsConfig = base({ chat_api: "push" });
    const get = pushOnlyEndpoints(() => stored);
    // The reset clears the override to "no override" — the merged config carries no chat_api.
    stored = base({ chat_api: undefined });
    expect(get().chat_api).toBe("push");
  });

  it("passes the rest of the endpoints through unchanged", () => {
    const get = pushOnlyEndpoints(() => base({ stt_base_url: "http://stt.test/v1" }));
    const endpoints = get();
    expect(endpoints.chat_base_url).toBe("ws://gateway.test");
    expect(endpoints.stt_base_url).toBe("http://stt.test/v1");
  });
});
