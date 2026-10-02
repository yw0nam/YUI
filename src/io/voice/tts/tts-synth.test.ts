/**
 * tts-synth.test.ts — the single TTS path: per-sentence HTTP call + the provider adapter.
 *
 * createTtsSynth({ provider, baseUrl, fetch?, model?, voice?, getApiKey? }) → (input, signal?, opts?) => ArrayBuffer.
 * POST {tts_base_url}/v1/audio/speech, body { input, response_format:"wav", ...model/voice, ...direction }.
 * The provider decides how emotion_text and caption ride: Irodori prefixes the emoji onto `input`
 * and sends `irodori.caption`; OpenAI joins both into `instructions`.
 * On non-2xx, throws an Error including status + (when JSON) error.message. On success, response.arrayBuffer().
 *
 * createTtsProvider binds that call to the live endpoints' provider + the active speaker id.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../../contract";
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
      provider: "irodori",
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
      provider: "irodori",
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
      provider: "irodori",
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
      provider: "irodori",
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
      provider: "irodori",
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("Hi.");
    await synth("Hi.", undefined, {});
    for (const call of fetchMock.mock.calls) {
      expect("irodori" in JSON.parse(call[1].body as string)).toBe(false);
    }
  });

  it("prefixes the emotion_text tag onto the Irodori input", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      provider: "irodori",
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await synth("やったー！", undefined, { emotion_text: "😆😆" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.input).toBe("😆😆 やったー！");
  });

  // The emoji voice tag rides inline in the spoken text — nothing may strip or relocate it.
  it("passes an emoji-prefixed input through to `input` untouched", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = createTtsSynth({
      provider: "irodori",
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
      provider: "irodori",
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
      provider: "irodori",
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
      provider: "irodori",
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
        provider: "irodori",
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
        provider: "irodori",
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
      });

      await expect(synth("hi")).resolves.toBeInstanceOf(ArrayBuffer);
      // No pending timer should remain once the request has already settled.
      expect(vi.getTimerCount()).toBe(0);
    });

    // Mirrors tauri-plugin-cors-fetch, which ignores signal.reason and rejects with this bare string.
    it("rejects with the deadline reason when the transport rejects with its own cancel error", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            if (init.signal?.aborted) reject("User cancelled the request");
            else init.signal?.addEventListener("abort", () => reject("User cancelled the request"));
          }),
      );
      const synth = createTtsSynth({
        provider: "irodori",
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
      });

      const pending = synth("hi");
      const assertion = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
        message: "TTS request timed out",
      });
      await vi.advanceTimersByTimeAsync(TTS_SYNTH_TIMEOUT_MS + 10);
      await assertion;
    });

    it("reports a caller abort as the caller's abort, not a timeout", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            if (init.signal?.aborted) reject("User cancelled the request");
            else init.signal?.addEventListener("abort", () => reject("User cancelled the request"));
          }),
      );
      const synth = createTtsSynth({
        provider: "irodori",
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
      });

      const controller = new AbortController();
      const pending = synth("hi", controller.signal);
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      controller.abort();
      await assertion;
    });

    it("keeps the HTTP status when the deadline fires while reading an error body", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(async (_url, init) => {
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => reject("User cancelled the request"));
            }),
        } as unknown as Response;
      });
      const synth = createTtsSynth({
        provider: "irodori",
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
      });

      const pending = synth("hi");
      const assertion = expect(pending).rejects.toThrow("TTS request failed (HTTP 500)");
      await vi.advanceTimersByTimeAsync(TTS_SYNTH_TIMEOUT_MS + 10);
      await assertion;
    });

    it("rejects with the deadline reason when the deadline fires while reading the audio body", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(async (_url, init) => {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => reject("User cancelled the request"));
            }),
        } as unknown as Response;
      });
      const synth = createTtsSynth({
        provider: "irodori",
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
      });

      const pending = synth("hi");
      const assertion = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
        message: "TTS request timed out",
      });
      await vi.advanceTimersByTimeAsync(TTS_SYNTH_TIMEOUT_MS + 10);
      await assertion;
    });

    it("rejects with the deadline reason when the audio body never settles and the transport ignores the abort", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
        } as unknown as Response;
      });
      const synth = createTtsSynth({
        provider: "irodori",
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
      });

      const pending = synth("hi");
      const assertion = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
        message: "TTS request timed out",
      });
      await vi.advanceTimersByTimeAsync(TTS_SYNTH_TIMEOUT_MS + 10);
      await assertion;
    });

    it("rejects with the HTTP error when the error body never settles and the transport ignores the abort", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<FetchFn>(async () => {
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: () => new Promise(() => {}),
        } as unknown as Response;
      });
      const synth = createTtsSynth({
        provider: "irodori",
        baseUrl: BASE_URL,
        fetch: fetchMock as unknown as typeof fetch,
      });

      const pending = synth("hi");
      const assertion = expect(pending).rejects.toThrow("TTS request failed (HTTP 500)");
      await vi.advanceTimersByTimeAsync(TTS_SYNTH_TIMEOUT_MS + 10);
      await assertion;
    });
  });

  it("adds Authorization: Bearer when getApiKey resolves a key, keeping Content-Type", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(2)));
    const synth = createTtsSynth({
      provider: "irodori",
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
        provider: "irodori",
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

describe("createTtsSynth — openai", () => {
  const openaiSynth = (fetchMock: ReturnType<typeof vi.fn<FetchFn>>) =>
    createTtsSynth({
      provider: "openai",
      baseUrl: "https://api.openai.com",
      fetch: fetchMock as unknown as typeof fetch,
      model: "gpt-4o-mini-tts",
      voice: "coral",
      getApiKey: async () => "sk-openai",
    });

  it("sends the plain input with emotion_text and caption joined into instructions", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    await openaiSynth(fetchMock)("やったー！", undefined, {
      emotion_text: "😆😆",
      caption: "明るく弾んだ声で。",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(init.body as string)).toEqual({
      input: "やったー！",
      response_format: "wav",
      model: "gpt-4o-mini-tts",
      voice: "coral",
      instructions: "😆😆 明るく弾んだ声で。",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-openai");
  });

  it("sends whichever direction is present on its own", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const synth = openaiSynth(fetchMock);
    await synth("a", undefined, { emotion_text: "👂" });
    await synth("b", undefined, { caption: "落ち着いた低めの声で。" });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string));
    expect(bodies.map((b) => b.instructions)).toEqual(["👂", "落ち着いた低めの声で。"]);
  });

  it("omits instructions when the sentence carries no direction", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    await openaiSynth(fetchMock)("plain");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      input: "plain",
      response_format: "wav",
      model: "gpt-4o-mini-tts",
      voice: "coral",
    });
  });
});

describe("createTtsProvider", () => {
  const endpoints = (overrides: Partial<EndpointsConfig> = {}): EndpointsConfig => ({
    chat_base_url: "http://localhost:8643/v1",
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

  it("isReady stays false for a provider with no synth", () => {
    const provider = createTtsProvider({
      getEndpoints: () => endpoints({ tts_provider: "fish" }),
      getActiveSpeaker: () => ({ id: "ナツメ", ref_url: "" }),
      selectFetch: async () => undefined,
    });
    expect(provider.isReady()).toBe(false);
  });

  it("paramsKey joins the provider, tts_base_url, tts_model and the active speaker id", () => {
    let eps = endpoints();
    let speakerId = "ナツメ";
    const provider = createTtsProvider({
      getEndpoints: () => eps,
      getActiveSpeaker: () => ({ id: speakerId, ref_url: "" }),
      selectFetch: async () => undefined,
    });

    expect(provider.paramsKey()).toBe("irodori::http://localhost:8092::irodori-tts::ナツメ");

    speakerId = "ムラサメ";
    expect(provider.paramsKey()).toBe("irodori::http://localhost:8092::irodori-tts::ムラサメ");

    eps = endpoints({ tts_model: "other" });
    expect(provider.paramsKey()).toBe("irodori::http://localhost:8092::other::ムラサメ");

    eps = endpoints({ tts_model: "other", tts_provider: "openai" });
    expect(provider.paramsKey()).toBe("openai::http://localhost:8092::other::ムラサメ");
  });

  it("synth speaks the provider the live endpoints select", async () => {
    let eps = endpoints();
    const fetchMock = vi.fn<FetchFn>(async () => okResponse(new ArrayBuffer(4)));
    const provider = createTtsProvider({
      getEndpoints: () => eps,
      getActiveSpeaker: () => ({ id: "coral", ref_url: "" }),
      selectFetch: async () => fetchMock as unknown as typeof fetch,
    });

    await provider.synth("hi", undefined, { caption: "囁くように。" });
    eps = endpoints({ tts_provider: "openai", tts_model: "gpt-4o-mini-tts" });
    await provider.synth("hi", undefined, { caption: "囁くように。" });

    const [irodori, openai] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string));
    expect(irodori.irodori).toEqual({ caption: "囁くように。" });
    expect(openai).toMatchObject({ model: "gpt-4o-mini-tts", instructions: "囁くように。" });
    expect("irodori" in openai).toBe(false);
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
