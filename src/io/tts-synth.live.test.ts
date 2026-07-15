/**
 * Integration test against the real TTS service (:8092) — runs only when `YUI_LIVE=1`.
 *   YUI_LIVE=1 pnpm exec vitest run src/io/tts-synth.live.test.ts
 */
import { describe, expect, it } from "vitest";
import type { EndpointsConfig } from "../contract";
import type { AudioSink } from "./audio-player";
import { createTtsPipeline } from "./tts-pipeline";
import { createTtsSynth } from "./tts-synth";

const LIVE = process.env.YUI_LIVE === "1";

const endpoints: EndpointsConfig = {
  chat_base_url: "http://localhost:8643/v1",
  chat_endpoint: "/v1/responses",
  stt_base_url: "http://localhost:5517",
  tts_base_url: "http://localhost:8092",
};

/** Check the RIFF....WAVE header (first 4 bytes "RIFF", bytes 8-11 "WAVE"). */
function isWav(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  return tag(0) === "RIFF" && tag(8) === "WAVE";
}

describe.skipIf(!LIVE)("tts-synth — LIVE :8092 (fishaudio/s2-pro)", () => {
  it("plain input → wav 바이너리", async () => {
    const synth = createTtsSynth({ config: endpoints });
    const wav = await synth("Hello, can you hear me?");
    expect(wav.byteLength).toBeGreaterThan(1000);
    expect(isWav(wav), "RIFF/WAVE 헤더여야 함").toBe(true);
  }, 60_000);

  it("emotion_text prefix가 붙은 input도 합성된다", async () => {
    const synth = createTtsSynth({ config: endpoints });
    const wav = await synth("[whisper in small voice] Can you hear me?");
    expect(isWav(wav)).toBe(true);
  }, 60_000);

  it("pipeline: 다문장 → 분절 → 실 synth → ordered playback(submission 순서)", async () => {
    const playedBytes: number[] = [];
    const fakeSink: AudioSink = {
      async play(wav) {
        expect(isWav(wav)).toBe(true);
        playedBytes.push(wav.byteLength);
      },
      stop() {},
    };
    const tts = createTtsPipeline({ config: endpoints, sink: fakeSink });
    tts.pushTextDelta("First sentence. Second sentence! Third one?");
    tts.end();

    // Wait (poll) until every synth + playback has finished.
    const deadline = Date.now() + 55_000;
    while (playedBytes.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(playedBytes.length, "3문장 모두 재생되어야 함").toBe(3);
    tts.dispose();
  }, 60_000);
});
