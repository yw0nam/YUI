import { afterEach, describe, expect, it, vi } from "vitest";
import { createSttServerCheck } from "./stt-server-check";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSttServerCheck", () => {
  it("counts any HTTP answer as reachable — a transcription-only server answers /models with 405", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", ((url: string | URL | Request) => {
      urls.push(String(url));
      return Promise.resolve(new Response("", { status: 405 }));
    }) as typeof fetch);
    const check = createSttServerCheck({
      getEndpoints: () => ({ stt_base_url: "https://stt.test/v1" }),
      getApiKey: async () => undefined,
    });

    await expect(check()).resolves.toEqual({ kind: "ok" });
    expect(urls).toEqual(["https://stt.test/v1/models"]);
  });

  it.each([
    ["no endpoints", () => null],
    ["no STT URL", () => ({ stt_base_url: "" })],
  ])("resolves null with %s", (_name, getEndpoints) => {
    const check = createSttServerCheck({ getEndpoints, getApiKey: async () => undefined });

    return expect(check()).resolves.toBeNull();
  });
});
