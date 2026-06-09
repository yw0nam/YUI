/**
 * stt-vad.test.ts — STT + VAD pipeline (TDD red, #19).
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EndpointsConfig } from "../contract";

// ── mock @ricky0123/vad-web ───────────────────────────────────────────────────
// Capture the options passed to MicVAD.new() and expose a handle to trigger onSpeechEnd.
let capturedOptions: Record<string, unknown> = {};
let triggerSpeechStart: (() => void) | null = null;
let triggerSpeechEnd: ((audio: Float32Array) => Promise<void>) | null = null;

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
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ text: responseText }),
  } as unknown as Response);
}

beforeEach(() => {
  capturedOptions = {};
  triggerSpeechStart = null;
  triggerSpeechEnd = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── import after mocks ────────────────────────────────────────────────────────
const { createSttVad } = await import("./stt-vad");

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
    vi.stubGlobal("fetch", buildFetchMock("hello"));

    const onState = vi.fn();
    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment, onState });
    await stt.start();

    await triggerSpeechEnd!(new Float32Array([0.1, 0.2]));

    expect(onState.mock.calls.map(([state]) => state)).toEqual(["asr", "fired"]);
    expect(onVoiceSegment).toHaveBeenCalledWith({ text: "hello" });
  });

  it("reports error when STT fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const onState = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment: vi.fn(), onState });
    await stt.start();

    await triggerSpeechEnd!(new Float32Array([0.1, 0.2]));

    expect(onState).toHaveBeenCalledWith("asr");
    expect(onState).toHaveBeenCalledWith("error", "HTTP 500");
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
  it("fetches /audio/transcriptions and calls onVoiceSegment with transcript", async () => {
    const fetchMock = buildFetchMock("こんにちは");
    vi.stubGlobal("fetch", fetchMock);

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();

    expect(triggerSpeechEnd).toBeDefined();
    const audio = new Float32Array([0.1, 0.2, 0.3]);
    await triggerSpeechEnd!(audio);

    // Must POST to stt_base_url/audio/transcriptions (server has the /v1 prefix)
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5517/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    // transcript forwarded
    expect(onVoiceSegment).toHaveBeenCalledOnce();
    expect(onVoiceSegment).toHaveBeenCalledWith({ text: "こんにちは" });
  });

  it("sends audio as a Blob under the key 'file' in FormData", async () => {
    const fetchMock = buildFetchMock("test");
    vi.stubGlobal("fetch", fetchMock);

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();

    const audio = new Float32Array(16);
    await triggerSpeechEnd!(audio);

    const body = fetchMock.mock.calls[0][1].body as FormData;
    const file = body.get("file");
    expect(file).toBeInstanceOf(Blob);
  });

  it("sends audio data that encodes the Float32Array samples", async () => {
    const fetchMock = buildFetchMock("ok");
    vi.stubGlobal("fetch", fetchMock);

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();

    const audio = new Float32Array([0.5, -0.5, 0.1]);
    await triggerSpeechEnd!(audio);

    const body = fetchMock.mock.calls[0][1].body as FormData;
    const file = body.get("file") as Blob;
    // Blob must be non-empty (encodes PCM samples)
    expect(file.size).toBeGreaterThan(0);
  });
});

describe("createSttVad — STT error resilience", () => {
  it("does not call onVoiceSegment when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();
    await triggerSpeechEnd!(new Float32Array(16));

    expect(onVoiceSegment).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("does not call onVoiceSegment when response.ok is false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onVoiceSegment = vi.fn();
    const stt = createSttVad({ config: CONFIG, onVoiceSegment });
    await stt.start();
    await triggerSpeechEnd!(new Float32Array(16));

    expect(onVoiceSegment).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
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
