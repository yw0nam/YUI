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

function setup(options: { isFiller?: (text: string) => boolean } = {}) {
  let byte = 1;
  const synth = vi.fn(async () => wav(byte++));
  let paramsKey = "params-a";
  const cached = createFillerAudioCache({
    synth,
    isFiller: options.isFiller ?? ((text) => text === "음..."),
    paramsKey: () => paramsKey,
  });
  return {
    synth,
    cached,
    setParamsKey: (next: string) => {
      paramsKey = next;
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

  it("never caches text outside the filler pool", async () => {
    const { synth, cached } = setup();

    await cached("오늘 날씨는 맑아요.");
    await cached("오늘 날씨는 맑아요.");

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
