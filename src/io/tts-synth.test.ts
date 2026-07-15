/**
 * tts-synth.test.ts — per-sentence TTS HTTP call.
 *
 * Target: createTtsSynth({ config, fetch, model?, voice?, speed? }) → (input, signal?) => Promise<ArrayBuffer>.
 * POST {tts_base_url}/v1/audio/speech, body { input, response_format:"wav", ...model/voice/speed }.
 * On non-2xx, throws an Error including status + (when JSON) error.message. On success, response.arrayBuffer().
 *
 * VERIFIED FACTS (live probe done): vLLM fishaudio/s2-pro, OpenAI-compatible /v1/audio/speech.
 * Tests use only a mock fetch — no real :8092 connection.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import { createTtsSynth, TTS_SYNTH_TIMEOUT_MS } from "./tts-synth";

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

  it("propagates the caller's abort to the request signal", async () => {
    const fetchMock = vi.fn<FetchFn>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const abortWith = () =>
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          if (init.signal?.aborted) abortWith();
          else init.signal?.addEventListener("abort", abortWith);
        }),
    );
    const synth = createTtsSynth({ config: CONFIG, fetch: fetchMock as unknown as typeof fetch });
    const ac = new AbortController();
    const pending = synth("hi", ac.signal);
    ac.abort();
    await expect(pending).rejects.toThrow();
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal?.aborted).toBe(true);
  });

  describe("per-request deadline", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("aborts a hung request once TTS_SYNTH_TIMEOUT_MS elapses", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            );
          }),
      );
      const synth = createTtsSynth({
        config: CONFIG,
        fetch: fetchMock as unknown as typeof fetch,
      });

      const pending = synth("hi");
      const assertion = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(TTS_SYNTH_TIMEOUT_MS + 10);
      await assertion;
    });

    it("does not fire the deadline when the request settles first", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
      const synth = createTtsSynth({
        config: CONFIG,
        fetch: fetchMock as unknown as typeof fetch,
      });

      await expect(synth("hi")).resolves.toBeInstanceOf(ArrayBuffer);
      // No pending timer should remain once the request has already settled.
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("adds Authorization: Bearer when getApiKey resolves a key, keeping Content-Type", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(2)));
    const synth = createTtsSynth({
      config: CONFIG,
      fetch: fetchMock as unknown as typeof fetch,
      getApiKey: async () => "sk-tts",
    });
    await synth("hi");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-tts");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("omits Authorization when getApiKey is absent, empty, or whitespace", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(2)));
    for (const getApiKey of [undefined, async () => "", async () => "   "]) {
      const synth = createTtsSynth({
        config: CONFIG,
        fetch: fetchMock as unknown as typeof fetch,
        getApiKey,
      });
      await synth("hi");
    }
    for (const call of fetchMock.mock.calls) {
      expect("Authorization" in (call[1].headers as object)).toBe(false);
    }
  });
});
