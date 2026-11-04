import { describe, expect, it, vi } from "vitest";
import type { TtsProviderName } from "../../../contract";

const { selectFetch } = vi.hoisted(() => ({
  selectFetch: vi.fn<typeof import("../../chat/stream/chat-client").selectFetch>(),
}));
vi.mock("../../chat/stream/chat-client", () => ({ selectFetch }));

import { createTtsServerCheck } from "./tts-server-check";
import type { VoiceListOutcome } from "./voice-list-refresh";

const OPENAI = { tts_base_url: "http://oai.test/", tts_provider: "openai" as TtsProviderName };
const IRODORI = { tts_base_url: "http://irodori.test", tts_provider: "irodori" as TtsProviderName };

describe("createTtsServerCheck", () => {
  it.each([
    [
      "openai, model list 404",
      OPENAI,
      async () => new Response("", { status: 404 }),
      { kind: "ok" },
    ],
    [
      "openai, fetch rejects",
      OPENAI,
      async () => {
        throw new TypeError("connection refused");
      },
      { kind: "unreachable" },
    ],
  ])("reads {tts_base_url}/v1/models for %s", async (_l, eps, impl, expected) => {
    const fetchImpl = vi.fn<typeof fetch>(impl);
    selectFetch.mockResolvedValue(fetchImpl);
    const refreshVoiceList = vi.fn<() => Promise<VoiceListOutcome>>();
    const check = createTtsServerCheck({
      getEndpoints: () => eps,
      getApiKey: async () => undefined,
      refreshVoiceList,
    });

    await expect(check()).resolves.toEqual(expected);
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toEqual(["http://oai.test/v1/models"]);
    expect(refreshVoiceList).not.toHaveBeenCalled();
  });

  it.each([
    ["irodori, list timed out", IRODORI, { kind: "timeout" }, { kind: "timeout" }],
    ["irodori, refresh skipped", IRODORI, { kind: "skipped" }, null],
    ["no TTS URL", { tts_provider: "irodori" as TtsProviderName }, { kind: "ok" }, null],
  ] as const)("returns the voice list refresh outcome for %s", async (_l, eps, outcome, expected) => {
    const check = createTtsServerCheck({
      getEndpoints: () => eps,
      getApiKey: async () => undefined,
      refreshVoiceList: async () => outcome,
    });

    await expect(check()).resolves.toEqual(expected);
  });
});
