/**
 * tts-synth.test.ts — per-sentence TTS HTTP call.
 *
 * 대상: createTtsSynth({ config, fetch, model?, voice?, speed? }) → (input, signal?) => Promise<ArrayBuffer>.
 * POST {tts_base_url}/v1/audio/speech, body { input, response_format:"wav", ...model/voice/speed }.
 * 비2xx면 status + (JSON일 때) error.message 포함 Error throw. 성공 시 response.arrayBuffer().
 *
 * VERIFIED FACTS(라이브 프로브 완료): vLLM fishaudio/s2-pro, OpenAI 호환 /v1/audio/speech.
 * 테스트는 mock fetch만 사용 — 실제 :8092 미접속.
 */

import { describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import { createTtsSynth } from "./tts-synth";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

function okResponse(buf: ArrayBuffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf,
  } as unknown as Response;
}

describe("createTtsSynth", () => {
  it("POSTs to {tts_base_url}/v1/audio/speech with input + response_format:wav", async () => {
    const buf = new ArrayBuffer(8);
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(buf));
    const synth = createTtsSynth({ config: CONFIG, fetch: fetchMock as unknown as typeof fetch });

    const out = await synth("Hello there.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8092/v1/audio/speech");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ input: "Hello there.", response_format: "wav" });
    expect(out).toBe(buf);
  });

  it("includes model/voice/speed when configured, omits them otherwise", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      config: CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      model: "fishaudio/s2-pro",
      voice: "alloy",
      speed: 1.2,
    });
    await synth("Hi.");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("fishaudio/s2-pro");
    expect(body.voice).toBe("alloy");
    expect(body.speed).toBe(1.2);
  });

  it("omits model/voice/speed keys entirely when not configured", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({ config: CONFIG, fetch: fetchMock as unknown as typeof fetch });
    await synth("Hi.");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect("model" in body).toBe(false);
    expect("voice" in body).toBe(false);
    expect("speed" in body).toBe(false);
  });

  it("throws on non-2xx with status + parsed error.message (JSON error body)", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "input too long" } }),
        }) as unknown as Response,
    );
    const synth = createTtsSynth({ config: CONFIG, fetch: fetchMock as unknown as typeof fetch });

    await expect(synth("x")).rejects.toThrow(/400/);
    await expect(synth("x")).rejects.toThrow(/input too long/);
  });

  it("throws with status even when error body is not JSON", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 503,
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response,
    );
    const synth = createTtsSynth({ config: CONFIG, fetch: fetchMock as unknown as typeof fetch });
    await expect(synth("x")).rejects.toThrow(/503/);
  });

  it("passes the AbortSignal through to fetch", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(2)));
    const synth = createTtsSynth({ config: CONFIG, fetch: fetchMock as unknown as typeof fetch });
    const ac = new AbortController();
    await synth("hi", ac.signal);
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBe(ac.signal);
  });
});
