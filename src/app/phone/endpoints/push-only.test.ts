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
  it("returns chat_api push whatever the underlying accessor says and passes the rest through unchanged", () => {
    const get = pushOnlyEndpoints(() =>
      base({ chat_api: "chat_completions", stt_base_url: "http://stt.test/v1" }),
    );
    expect(get()).toEqual({ ...base({ stt_base_url: "http://stt.test/v1" }), chat_api: "push" });
  });
});
