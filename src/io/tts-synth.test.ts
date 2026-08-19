/**
 * tts-synth.test.ts — the single TTS path: per-sentence HTTP call + the provider adapter.
 *
 * createTtsSynth({ baseUrl, fetch?, model?, voice?, getApiKey? }) → (input, signal?) => ArrayBuffer.
 * POST {tts_base_url}/v1/audio/speech, body { input, response_format:"wav", ...model/voice }.
 * On non-2xx, throws an Error including status + (when JSON) error.message. On success, response.arrayBuffer().
 *
 * createTtsProvider binds that call to the live endpoints + the active speaker id.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";
import { createTtsProvider, createTtsSynth, TTS_SYNTH_TIMEOUT_MS } from "./tts-synth";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const BASE_URL = "http://localhost:8092";

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
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await synth("Hello there.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8092/v1/audio/speech");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ input: "Hello there.", response_format: "wav" });
    expect(out).toBe(buf);
  });

  it("includes model/voice when configured, omits them otherwise", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      model: "irodori-tts",
      voice: "ナツメ",
    });
    await synth("Hi.");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("irodori-tts");
    expect(body.voice).toBe("ナツメ");
  });

  it("omits model/voice keys entirely when not configured", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("Hi.");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect("model" in body).toBe(false);
    expect("voice" in body).toBe(false);
  });

  it("adds irodori.caption to the body when a caption is passed per call", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("Hi.", undefined, { caption: "落ち着いた低めの声で。" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.irodori).toEqual({ caption: "落ち着いた低めの声で。" });
  });

  it("omits the irodori key entirely when no caption is passed", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("Hi.");
    await synth("Hi.", undefined, {});
    for (const call of fetchMock.mock.calls) {
      expect("irodori" in JSON.parse(call[1].body as string)).toBe(false);
    }
  });

  // The emoji voice tag rides inline in the spoken text — nothing may strip or relocate it.
  it("passes an emoji-prefixed input through to `input` untouched", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("😆😆 やったー！");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.input).toBe("😆😆 やったー！");
  });

  it("throws on non-2xx with status + parsed error.message (JSON error body)", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "Unknown model 'bogus'" } }),
        }) as unknown as Response,
    );
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(synth("x")).rejects.toThrow(/400/);
    await expect(synth("x")).rejects.toThrow(/Unknown model 'bogus'/);
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
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
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
    const synth = createTtsSynth({
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
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
        baseUrl: BASE_URL,
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
        baseUrl: BASE_URL,
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
      baseUrl: BASE_URL,
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
        baseUrl: BASE_URL,
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

describe("createTtsProvider", () => {
  const endpoints = (overrides: Partial<EndpointsConfig> = {}): EndpointsConfig => ({
    chat_base_url: "http://localhost:8643/v1",
    chat_endpoint: "/v1/responses",
    stt_base_url: "http://localhost:5517",
    tts_base_url: BASE_URL,
    tts_model: "irodori-tts",
    ...overrides,
  });

  it("isReady requires both tts_base_url and an active speaker id", () => {
    const build = (eps: EndpointsConfig, speakerId: string) =>
      createTtsProvider({
        getEndpoints: () => eps,
        getActiveSpeaker: () => ({ id: speakerId, ref_url: "" }),
        selectFetch: async () => undefined,
      });

    expect(build(endpoints({ tts_base_url: "" }), "ナツメ").isReady()).toBe(false);
    expect(build(endpoints(), "").isReady()).toBe(false);
    expect(build(endpoints(), "ナツメ").isReady()).toBe(true);
  });

  it("paramsKey joins tts_base_url, tts_model and the active speaker id", () => {
    let eps = endpoints();
    let speakerId = "ナツメ";
    const provider = createTtsProvider({
      getEndpoints: () => eps,
      getActiveSpeaker: () => ({ id: speakerId, ref_url: "" }),
      selectFetch: async () => undefined,
    });

    expect(provider.paramsKey()).toBe("http://localhost:8092::irodori-tts::ナツメ");

    speakerId = "ムラサメ";
    expect(provider.paramsKey()).toBe("http://localhost:8092::irodori-tts::ムラサメ");

    eps = endpoints({ tts_model: "other" });
    expect(provider.paramsKey()).toBe("http://localhost:8092::other::ムラサメ");
  });

  it("synth resolves fetch via selectFetch and posts model + the active speaker as voice", async () => {
    const buf = new ArrayBuffer(4);
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(buf));
    const provider = createTtsProvider({
      getEndpoints: () => endpoints(),
      getActiveSpeaker: () => ({ id: "ナツメ", ref_url: "asset://x/clip.wav" }),
      getApiKey: async () => "sk-live",
      selectFetch: async () => fetchMock as unknown as typeof fetch,
    });

    const out = await provider.synth("hi");

    expect(out).toBe(buf);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8092/v1/audio/speech");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ input: "hi", model: "irodori-tts", voice: "ナツメ" });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-live");
  });

  it("threads a per-call caption through to the request body", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const provider = createTtsProvider({
      getEndpoints: () => endpoints(),
      getActiveSpeaker: () => ({ id: "ナツメ", ref_url: "" }),
      selectFetch: async () => fetchMock as unknown as typeof fetch,
    });

    await provider.synth("hi", undefined, { caption: "囁くような小さな声で。" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.irodori).toEqual({ caption: "囁くような小さな声で。" });
    expect(body.input).toBe("hi");
  });

  it("surfaces the server's error message out of synth", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "Unknown voice 'nope'" } }),
        }) as unknown as Response,
    );
    const provider = createTtsProvider({
      getEndpoints: () => endpoints(),
      getActiveSpeaker: () => ({ id: "nope", ref_url: "" }),
      selectFetch: async () => fetchMock as unknown as typeof fetch,
    });

    await expect(provider.synth("hi")).rejects.toThrow(/Unknown voice 'nope'/);
  });
});
