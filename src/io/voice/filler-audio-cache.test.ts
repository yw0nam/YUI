import { describe, expect, it, vi } from "vitest";
import { createFillerAudioCache } from "./filler-audio-cache";

function wav(byte: number): ArrayBuffer {
  const buffer = new ArrayBuffer(4);
  new Uint8Array(buffer).fill(byte);
  return buffer;
}

/** Mimics what decodeAudioData does to the buffer it is handed. */
function detach(buffer: ArrayBuffer): void {
  structuredClone(buffer, { transfer: [buffer] });
}

function setup() {
  let byte = 1;
  const synth = vi.fn(async () => wav(byte++));
  let paramsKey = "params-a";
  let submissions = new Set(["음..."]);
  const cache = createFillerAudioCache({
    synth,
    submissions: () => submissions,
    paramsKey: () => paramsKey,
  });
  return {
    synth,
    cache,
    cached: cache.synth,
    setParamsKey: (next: string) => {
      paramsKey = next;
    },
    setSubmissions: (next: string[]) => {
      submissions = new Set(next);
    },
  };
}

describe("createFillerAudioCache", () => {
  it("reuses the audio of a repeated filler phrase", async () => {
    const { synth, cached } = setup();

    const first = await cached("음...");
    const second = await cached("음...");

    expect(synth).toHaveBeenCalledOnce();
    expect(new Uint8Array(second)).toEqual(new Uint8Array(first));
  });

  it("forwards the abort signal on a miss", async () => {
    const { synth, cached } = setup();
    const signal = new AbortController().signal;

    await cached("음...", signal);

    expect(synth).toHaveBeenCalledWith("음...", signal);
  });

  it("re-synthesizes when the TTS params change", async () => {
    const { synth, cached, setParamsKey } = setup();

    await cached("음...");
    setParamsKey("params-b");
    const afterChange = await cached("음...");

    expect(synth).toHaveBeenCalledTimes(2);
    expect(new Uint8Array(afterChange)).toEqual(new Uint8Array(wav(2)));
  });

  it("drops every entry when the TTS params change", async () => {
    const { synth, cache, cached, setParamsKey, setSubmissions } = setup();
    setSubmissions(["음...", "그러니까..."]);

    await cached("음...");
    await cached("그러니까...");
    setParamsKey("params-b");

    expect(cache.has("음...")).toBe(false);
    expect(cache.has("그러니까...")).toBe(false);
    await cached("음...");
    await cached("그러니까...");
    expect(synth).toHaveBeenCalledTimes(4);
  });

  it("keeps the audio of a phrase the pool still submits when another phrase is edited", async () => {
    const { synth, cache, cached, setSubmissions } = setup();
    setSubmissions(["음...", "그러니까..."]);

    await cached("음...");
    await cached("그러니까...");
    setSubmissions(["음...", "그러니까 말이야..."]);

    expect(cache.has("음...")).toBe(true);
    await cached("음...");
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it("evicts a phrase the pool no longer submits", async () => {
    const { synth, cache, cached, setSubmissions } = setup();
    setSubmissions(["음...", "그러니까..."]);

    await cached("그러니까...");
    setSubmissions(["음..."]);
    expect(cache.has("그러니까...")).toBe(false);

    // Re-added later, its audio is gone and has to be synthesized again.
    setSubmissions(["음...", "그러니까..."]);
    await cached("그러니까...");
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it("reports has() false for a phrase that was never synthesized", () => {
    const { synth, cache } = setup();

    expect(cache.has("음...")).toBe(false);
    expect(synth).not.toHaveBeenCalled();
  });

  it("reports has() true for a stored phrase without synthesizing", async () => {
    const { synth, cache, cached } = setup();

    await cached("음...");

    expect(cache.has("음...")).toBe(true);
    expect(synth).toHaveBeenCalledOnce();
  });

  it("never caches text outside the filler pool", async () => {
    const { synth, cache, cached } = setup();

    await cached("오늘 날씨는 맑아요.");
    await cached("오늘 날씨는 맑아요.");

    expect(synth).toHaveBeenCalledTimes(2);
    expect(cache.has("오늘 날씨는 맑아요.")).toBe(false);
  });

  it("keeps audio that resolved under superseded params out of the cache", async () => {
    const releases: Array<(buffer: ArrayBuffer) => void> = [];
    const synth = vi.fn(() => new Promise<ArrayBuffer>((resolve) => releases.push(resolve)));
    let paramsKey = "params-a";
    const cache = createFillerAudioCache({
      synth,
      submissions: () => new Set(["음..."]),
      paramsKey: () => paramsKey,
    });

    const stale = cache.synth("음...");
    paramsKey = "params-b";
    const fresh = cache.synth("음...");
    releases[1]!(wav(2));
    await fresh;
    releases[0]!(wav(1));
    await stale;

    expect(new Uint8Array(await cache.synth("음..."))).toEqual(new Uint8Array(wav(2)));
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it("keeps audio that resolved after its phrase left the pool out of the cache", async () => {
    const releases: Array<(buffer: ArrayBuffer) => void> = [];
    const synth = vi.fn(() => new Promise<ArrayBuffer>((resolve) => releases.push(resolve)));
    let submissions = new Set(["음..."]);
    const cache = createFillerAudioCache({
      synth,
      submissions: () => submissions,
      paramsKey: () => "params-a",
    });

    const inFlight = cache.synth("음...");
    submissions = new Set(["그러니까..."]);
    expect(cache.has("음...")).toBe(false);
    releases[0]!(wav(1));
    await inFlight;

    // Storing it now would put back an entry no later prune can see.
    expect(cache.has("음...")).toBe(false);
    submissions = new Set(["음..."]);
    void cache.synth("음...");
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it("retries a phrase whose synth failed", async () => {
    const { synth, cached } = setup();
    synth.mockRejectedValueOnce(new Error("synth down"));

    await expect(cached("음...")).rejects.toThrow("synth down");
    await cached("음...");

    expect(synth).toHaveBeenCalledTimes(2);
  });

  it("hands out copies so playback cannot detach the cached audio", async () => {
    const { synth, cached } = setup();

    detach(await cached("음..."));
    detach(await cached("음..."));
    const third = await cached("음...");

    expect(synth).toHaveBeenCalledOnce();
    expect(new Uint8Array(third)).toEqual(new Uint8Array(wav(1)));
  });
});
