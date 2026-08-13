/**
 * stt-vad.test.ts — STT + VAD pipeline.
 *
 * Locks:
 *  - VAD onSpeechEnd → STT fetch (POST /audio/transcriptions) → onVoiceSegment.
 *  - silenceMs is passed through as redemptionFrames override (default 1500).
 *  - voice mode is off by default; start()/stop() control it.
 *  - dispose() tears down the VAD instance.
 *  - STT fetch sends multipart/form-data with audio blob.
 *  - STT error does not crash; onVoiceSegment is not called.
 *
 * No real mic / ONNX runtime in CI — mock @ricky0123/vad-web and fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../contract";

// ── mock @ricky0123/vad-web ───────────────────────────────────────────────────
// Capture the options passed to MicVAD.new() and expose a handle to trigger onSpeechEnd.
let capturedOptions: Record<string, unknown> = {};
let triggerSpeechStart: (() => void) | null = null;
let triggerSpeechEnd: ((audio: Float32Array) => Promise<void>) | null = null;
let triggerSpeechRealStart: (() => void) | null = null;

const mockMicVadInstance = {
  start: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@ricky0123/vad-web", () => ({
  MicVAD: {
    new: vi.fn(async (opts: Record<string, unknown>) => {
      capturedOptions = opts;
      triggerSpeechStart = opts.onSpeechStart as () => void;
      triggerSpeechEnd = opts.onSpeechEnd as (audio: Float32Array) => Promise<void>;
      triggerSpeechRealStart = opts.onSpeechRealStart as () => void;
      return mockMicVadInstance;
    }),
  },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const CONFIG: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517/v1",
  tts_base_url: "http://localhost:8092",
};

/** Build a fake fetch that returns a successful STT response. */
function buildFetchMock(responseText = "hello world") {
  return vi
    .fn<(input: URL | RequestInfo, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: responseText }),
    } as unknown as Response);
}

/** Replace the default MicVAD.new mock with one that resolves only when `resolve` is called. */
async function deferMicVadLoad(): Promise<{ resolve: () => void }> {
  const { MicVAD } = await import("@ricky0123/vad-web");
  let resolve!: () => void;
  const gate = new Promise<void>((r) => {
    resolve = r;
  });
  (MicVAD.new as ReturnType<typeof vi.fn>).mockImplementationOnce(
    async (opts: Record<string, unknown>) => {
      capturedOptions = opts;
      await gate;
      return mockMicVadInstance;
    },
  );
  return { resolve };
}

beforeEach(() => {
  capturedOptions = {};
  triggerSpeechStart = null;
  triggerSpeechEnd = null;
  triggerSpeechRealStart = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── import after mocks ────────────────────────────────────────────────────────
const { createSttVad, STT_REQUEST_TIMEOUT_MS } = await import("./stt-vad");

// ── tests ─────────────────────────────────────────────────────────────────────

describe("createSttVad — voice mode default", () => {
  it("starts with voice mode OFF (does not call MicVAD.new until start() is called)", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const onVoiceSegment = vi.fn();
    createSttVad({ config: CONFIG, onVoiceSegment });
    expect(MicVAD.new).not.toHaveBeenCalled();
  });
});

describe("createSttVad — start() loads VAD", () => {
  it("calls MicVAD.new after start()", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();
    expect(MicVAD.new).toHaveBeenCalledOnce();
  });

  it("serves VAD model, worklet, and ONNX wasm assets from Vite public path", async () => {
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });
    await stt.start();

    expect(capturedOptions.baseAssetPath).toBe("/vad/");
    expect(capturedOptions.onnxWASMBasePath).toBe("/vad/");
  });

  it("start() is idempotent — second call does not create a second VAD instance", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();
    await stt.start();
    expect(MicVAD.new).toHaveBeenCalledOnce();
  });
});

describe("createSttVad — silenceMs configurable", () => {
  it("silenceMs=2000 produces higher redemptionMs than silenceMs=1500", async () => {
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, silenceMs: 2000 });
    await stt.start();
    const ms2000 = capturedOptions.redemptionMs as number;

    vi.clearAllMocks();
    capturedOptions = {};
    triggerSpeechEnd = null;

    const stt2 = createSttVad({ config: CONFIG, onVoiceSegment, silenceMs: 1500 });
    await stt2.start();
    const ms1500 = capturedOptions.redemptionMs as number;

    expect(ms2000).toBeGreaterThan(ms1500);
  });

  it("default silenceMs is 1500 (redemptionMs is a positive number)", async () => {
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();
    expect(typeof capturedOptions.redemptionMs).toBe("number");
    expect((capturedOptions.redemptionMs as number) > 0).toBe(true);
  });
});

describe("createSttVad — runtime state callbacks", () => {
  it("reports listening when VAD detects speech start", async () => {
    const onState = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState });
    await stt.start();

    triggerSpeechStart!();

    expect(onState).toHaveBeenCalledWith("listening");
  });

  it("reports ASR posting before STT and fired after transcript forwarding", async () => {
    const fetchMock = buildFetchMock("hello");

    const onState = vi.fn();
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, onState, fetch: fetchMock });
    await stt.start();

    await triggerSpeechEnd!(new Float32Array([0.1, 0.2]));

    expect(onState.mock.calls.map(([state]) => state)).toEqual(["asr", "fired"]);
    expect(onVoiceSegment).toHaveBeenCalledWith("hello");
  });

  it("reports error when STT fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const onState = vi.fn();
    const stt = createSttVad({
      config: CONFIG,
      onVoiceSegment: vi.fn(),
      onState,
      fetch: fetchMock,
    });
    await stt.start();

    await triggerSpeechEnd!(new Float32Array([0.1, 0.2]));

    expect(onState).toHaveBeenCalledWith("asr");
    expect(onState).toHaveBeenCalledWith("error", "HTTP 500");
  });
});

describe("createSttVad — onSpeechActive (barge-in trigger, #279)", () => {
  it("fires onSpeechActive when the VAD's onSpeechRealStart callback fires", async () => {
    const onSpeechActive = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onSpeechActive });
    await stt.start();

    expect(triggerSpeechRealStart).toBeDefined();
    triggerSpeechRealStart!();

    expect(onSpeechActive).toHaveBeenCalledOnce();
  });

  it("does not throw when onSpeechActive is not provided", async () => {
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });
    await stt.start();

    expect(() => triggerSpeechRealStart!()).not.toThrow();
  });

  it("onSpeechRealStart is distinct from onSpeechStart — only onState('listening') fires on raw start", async () => {
    const onState = vi.fn();
    const onSpeechActive = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState, onSpeechActive });
    await stt.start();

    triggerSpeechStart!();

    expect(onState).toHaveBeenCalledWith("listening");
    expect(onSpeechActive).not.toHaveBeenCalled();
  });
});

describe("createSttVad — start() failure handling (#64)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("start() does not throw when MicVAD.new rejects (resilient)", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    (MicVAD.new as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );

    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });
    await expect(stt.start()).resolves.toBeUndefined();
  });

  it("reports error with a permission-denied detail when getUserMedia is blocked", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    (MicVAD.new as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );

    const onState = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState });
    await stt.start();

    const errorCall = onState.mock.calls.find(([state]) => state === "error");
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toMatch(/microphone|permission|mic/i);
  });

  it("reports error with a device-missing detail when no mic is found", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    (MicVAD.new as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("no device", "NotFoundError"),
    );

    const onState = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState });
    await stt.start();

    const errorCall = onState.mock.calls.find(([state]) => state === "error");
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toMatch(/device|found/i);
  });

  it("reports a distinguishable detail for VAD/asset init failures", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    (MicVAD.new as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("failed to fetch /vad/silero_vad_v5.onnx"),
    );

    const onState = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState });
    await stt.start();

    const errorCall = onState.mock.calls.find(([state]) => state === "error");
    expect(errorCall).toBeDefined();
    // Non-permission failures must NOT be mislabeled as a mic-permission problem.
    expect(errorCall![1]).not.toMatch(/permission/i);
  });

  it("permission-denied and asset-load failures produce different details", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const newMock = MicVAD.new as ReturnType<typeof vi.fn>;

    newMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const onStatePerm = vi.fn();
    await createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState: onStatePerm }).start();
    const permDetail = onStatePerm.mock.calls.find(([s]) => s === "error")?.[1];

    newMock.mockRejectedValueOnce(new Error("onnx wasm load error"));
    const onStateAsset = vi.fn();
    await createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState: onStateAsset }).start();
    const assetDetail = onStateAsset.mock.calls.find(([s]) => s === "error")?.[1];

    expect(permDetail).toBeDefined();
    expect(assetDetail).toBeDefined();
    expect(permDetail).not.toBe(assetDetail);
  });

  it("does not retain a VAD instance after a failed start (next start() retries)", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const newMock = MicVAD.new as ReturnType<typeof vi.fn>;
    newMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });
    await stt.start();
    await stt.start();

    expect(newMock).toHaveBeenCalledTimes(2);
  });
});

describe("createSttVad — onSpeechEnd → STT fetch → onVoiceSegment", () => {
  it("fetches /audio/transcriptions and calls onVoiceSegment with text", async () => {
    const fetchMock = buildFetchMock("こんにちは");
    const wrongTransport = buildFetchMock("wrong transport");
    vi.stubGlobal("fetch", wrongTransport);

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, fetch: fetchMock });
    await stt.start();

    expect(triggerSpeechEnd).toBeDefined();
    const audio = new Float32Array([0.1, 0.2, 0.3]);
    await triggerSpeechEnd!(audio);

    // Must POST to stt_base_url/audio/transcriptions (server has the /v1 prefix)
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(wrongTransport).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5517/v1/audio/transcriptions");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);

    // text forwarded
    expect(onVoiceSegment).toHaveBeenCalledOnce();
    expect(onVoiceSegment).toHaveBeenCalledWith("こんにちは");
  });

  it("uses globalThis.fetch when no fetch is injected", async () => {
    const globalFetch = buildFetchMock("global transport");
    vi.stubGlobal("fetch", globalFetch);

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();

    await triggerSpeechEnd!(new Float32Array([0.1, 0.2, 0.3]));

    expect(globalFetch).toHaveBeenCalledOnce();
    expect(onVoiceSegment).toHaveBeenCalledWith("global transport");
  });

  it("sends audio as a Blob under the key 'file' in FormData", async () => {
    const fetchMock = buildFetchMock("test");

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, fetch: fetchMock });
    await stt.start();

    const audio = new Float32Array(16);
    await triggerSpeechEnd!(audio);

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    const file = body.get("file");
    expect(file).toBeInstanceOf(Blob);
  });

  it("sends audio data that encodes the Float32Array samples", async () => {
    const fetchMock = buildFetchMock("ok");

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, fetch: fetchMock });
    await stt.start();

    const audio = new Float32Array([0.5, -0.5, 0.1]);
    await triggerSpeechEnd!(audio);

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    const file = body.get("file") as Blob;
    // Blob must be non-empty (encodes PCM samples)
    expect(file.size).toBeGreaterThan(0);
  });
});

describe("createSttVad — Authorization", () => {
  it("adds Authorization: Bearer when getApiKey resolves a key, never Content-Type", async () => {
    const fetchMock = buildFetchMock("ok");

    const stt = createSttVad({
      config: CONFIG,
      onVoiceSegment: vi.fn(),
      getApiKey: async () => "sk-stt",
      fetch: fetchMock,
    });
    await stt.start();
    await triggerSpeechEnd!(new Float32Array([0.1]));

    const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-stt");
    // FormData body must keep the browser-set multipart boundary — never set Content-Type.
    expect("Content-Type" in headers).toBe(false);
  });

  it("omits Authorization when getApiKey is absent, empty, or whitespace", async () => {
    for (const getApiKey of [undefined, async () => "", async () => "   "]) {
      const fetchMock = buildFetchMock("ok");
      const stt = createSttVad({
        config: CONFIG,
        onVoiceSegment: vi.fn(),
        getApiKey,
        fetch: fetchMock,
      });
      await stt.start();
      await triggerSpeechEnd!(new Float32Array([0.1]));
      const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
      expect("Authorization" in headers).toBe(false);
    }
  });
});

describe("createSttVad — STT error resilience", () => {
  it("does not call onVoiceSegment when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, fetch: fetchMock });
    await stt.start();
    await triggerSpeechEnd!(new Float32Array(16));

    expect(onVoiceSegment).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("does not call onVoiceSegment when response.ok is false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, fetch: fetchMock });
    await stt.start();
    await triggerSpeechEnd!(new Float32Array(16));

    expect(onVoiceSegment).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});

describe("createSttVad — per-request deadline (#275)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a signal that aborts a hung STT request once STT_REQUEST_TIMEOUT_MS elapses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_: URL | RequestInfo, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const abortWith = () =>
          reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) abortWith();
        else init?.signal?.addEventListener("abort", abortWith);
      });
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onState = vi.fn();
    const stt = createSttVad({
      config: CONFIG,
      onVoiceSegment: vi.fn(),
      onState,
      fetch: fetchMock,
    });
    await stt.start();

    const pending = triggerSpeechEnd!(new Float32Array(16));
    await vi.advanceTimersByTimeAsync(STT_REQUEST_TIMEOUT_MS + 10);
    await pending;

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(onState).toHaveBeenCalledWith("error", expect.any(String));
    warnSpy.mockRestore();
  });

  it("logs a warning via the project logger when the deadline drops the utterance", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_: URL | RequestInfo, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const abortWith = () =>
          reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) abortWith();
        else init?.signal?.addEventListener("abort", abortWith);
      });
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, fetch: fetchMock });
    await stt.start();

    const pending = triggerSpeechEnd!(new Float32Array(16));
    await vi.advanceTimersByTimeAsync(STT_REQUEST_TIMEOUT_MS + 10);
    await pending;

    expect(onVoiceSegment).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("createSttVad — stop() and dispose()", () => {
  it("stop() pauses the VAD instance", async () => {
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();
    stt.stop();
    expect(mockMicVadInstance.pause).toHaveBeenCalledOnce();
  });

  it("dispose() destroys the VAD instance", async () => {
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();
    await stt.dispose();
    expect(mockMicVadInstance.destroy).toHaveBeenCalledOnce();
  });

  it("dispose() before start() does not throw", async () => {
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await expect(stt.dispose()).resolves.not.toThrow();
  });

  it("stop() before start() does not throw", () => {
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    expect(() => stt.stop()).not.toThrow();
  });
});

describe("createSttVad — stop()/dispose() during in-flight MicVAD.new load", () => {
  it("dispose() called mid-load destroys the instance once loaded and never starts the mic", async () => {
    const { resolve } = await deferMicVadLoad();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });

    const startPromise = stt.start();
    const disposePromise = stt.dispose();
    resolve();
    await startPromise;
    await disposePromise;

    expect(mockMicVadInstance.destroy).toHaveBeenCalledOnce();
    expect(mockMicVadInstance.start).not.toHaveBeenCalled();
  });

  it("stop() called mid-load leaves the instance paused (never started) once loaded", async () => {
    const { resolve } = await deferMicVadLoad();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });

    const startPromise = stt.start();
    stt.stop();
    resolve();
    await startPromise;

    expect(mockMicVadInstance.start).not.toHaveBeenCalled();
  });

  it("dispose() wins when both stop() and dispose() are requested mid-load", async () => {
    const { resolve } = await deferMicVadLoad();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });

    const startPromise = stt.start();
    stt.stop();
    const disposePromise = stt.dispose();
    resolve();
    await startPromise;
    await disposePromise;

    expect(mockMicVadInstance.destroy).toHaveBeenCalledOnce();
    expect(mockMicVadInstance.start).not.toHaveBeenCalled();
  });

  it("a fresh start() after a mid-load dispose() creates and starts a new VAD instance", async () => {
    const { resolve } = await deferMicVadLoad();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });

    const startPromise = stt.start();
    const disposePromise = stt.dispose();
    resolve();
    await startPromise;
    await disposePromise;

    await stt.start();

    const { MicVAD } = await import("@ricky0123/vad-web");
    expect(MicVAD.new).toHaveBeenCalledTimes(2);
    expect(mockMicVadInstance.start).toHaveBeenCalledOnce();
  });
});

describe("createSttVad — start() resumes a paused instance instead of no-op'ing (#429)", () => {
  it("start() after stop() resumes the same instance (vad.start() called again, no reload)", async () => {
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });
    await stt.start();
    stt.stop();
    expect(mockMicVadInstance.pause).toHaveBeenCalledOnce();

    await stt.start();

    const { MicVAD } = await import("@ricky0123/vad-web");
    expect(MicVAD.new).toHaveBeenCalledOnce();
    expect(mockMicVadInstance.start).toHaveBeenCalledTimes(2);
  });

  it("start() after a mid-load stop() resumes using the already-loaded instance (no reload)", async () => {
    const { resolve } = await deferMicVadLoad();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });

    const startPromise = stt.start();
    stt.stop();
    resolve();
    await startPromise;
    expect(mockMicVadInstance.start).not.toHaveBeenCalled();

    await stt.start();

    const { MicVAD } = await import("@ricky0123/vad-web");
    expect(MicVAD.new).toHaveBeenCalledOnce();
    expect(mockMicVadInstance.start).toHaveBeenCalledOnce();
  });

  it("repeated start() calls while already running stay idempotent (no reload, no throw)", async () => {
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn() });
    await stt.start();

    await expect(stt.start()).resolves.toBeUndefined();
    await expect(stt.start()).resolves.toBeUndefined();

    const { MicVAD } = await import("@ricky0123/vad-web");
    expect(MicVAD.new).toHaveBeenCalledOnce();
  });
});

describe("createSttVad — no stt_base_url (silently disabled)", () => {
  it("start() is a no-op and does not throw when stt_base_url is absent", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const configNoStt = {
      chat_base_url: "http://localhost:8643/v1",
      chat_endpoint: "/v1/responses",
    } as unknown as import("../contract").EndpointsConfig;

    const stt = createSttVad({ config: configNoStt, onVoiceSegment: vi.fn() });
    await expect(stt.start()).resolves.toBeUndefined();
    // VAD should not start.
    expect(MicVAD.new).not.toHaveBeenCalled();
  });

  it("stop() with no stt_base_url does not throw", () => {
    const configNoStt = {
      chat_base_url: "http://localhost:8643/v1",
      chat_endpoint: "/v1/responses",
    } as unknown as import("../contract").EndpointsConfig;

    const stt = createSttVad({ config: configNoStt, onVoiceSegment: vi.fn() });
    expect(() => stt.stop()).not.toThrow();
  });
});

describe("createSttVad — live config getter tracks settings-UI overrides (#611)", () => {
  it("accepts a config getter and reads stt_base_url from it at request time, not at construction", async () => {
    const fetchMock = buildFetchMock("ok");
    let current = CONFIG;

    const stt = createSttVad({ config: () => current, onVoiceSegment: vi.fn(), fetch: fetchMock });
    // Override applied after the engine was created — the bug this test locks was the engine
    // capturing a static config object at construction time and never re-reading it.
    current = { ...CONFIG, stt_base_url: "http://override.test/v1" };
    await stt.start();

    await triggerSpeechEnd!(new Float32Array([0.1]));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://override.test/v1/audio/transcriptions");
  });

  it("changing the override between requests retargets the next transcription request", async () => {
    const fetchMock = buildFetchMock("ok");
    let current = CONFIG;

    const stt = createSttVad({ config: () => current, onVoiceSegment: vi.fn(), fetch: fetchMock });
    await stt.start();

    await triggerSpeechEnd!(new Float32Array([0.1]));
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:5517/v1/audio/transcriptions");

    current = { ...CONFIG, stt_base_url: "http://override2.test/v1" };
    await triggerSpeechEnd!(new Float32Array([0.1]));
    expect(fetchMock.mock.calls[1][0]).toBe("http://override2.test/v1/audio/transcriptions");
  });

  it("start() is still a no-op when the config getter currently returns no stt_base_url", async () => {
    const { MicVAD } = await import("@ricky0123/vad-web");
    const current: import("../contract").EndpointsConfig = {
      chat_base_url: "http://localhost:8643/v1",
      chat_endpoint: "/v1/responses",
    } as unknown as import("../contract").EndpointsConfig;

    const stt = createSttVad({ config: () => current, onVoiceSegment: vi.fn() });
    await expect(stt.start()).resolves.toBeUndefined();
    expect(MicVAD.new).not.toHaveBeenCalled();
  });
});
