/**
 * Live test against Fish Audio (https://api.fish.audio) — runs only when `YUI_LIVE=1` and
 * `FISH_SPEECH_API_KEY` is set; CI skips it.
 *   set -a; . ./.env.local; set +a; YUI_LIVE=1 pnpm exec vitest run src/io/voice/tts/tts-synth.fish.live.test.ts
 */
import { describe, expect, it } from "vitest";
import { listFishVoices } from "../voices/fish-voices";
import { createTtsSynth } from "./tts-synth";

const LIVE = process.env.YUI_LIVE === "1" && Boolean(process.env.FISH_SPEECH_API_KEY);

const BASE_URL = "https://api.fish.audio";
const MODEL = "s2.1-pro-free";
const getApiKey = async () => process.env.FISH_SPEECH_API_KEY;

/** Check the RIFF....WAVE header (first 4 bytes "RIFF", bytes 8-11 "WAVE"). */
function isWav(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  return tag(0) === "RIFF" && tag(8) === "WAVE";
}

describe.skipIf(!LIVE)("tts-synth — LIVE Fish Audio", () => {
  it("synthesizes one line through the default model into wav bytes", async () => {
    const own = await listFishVoices({ baseUrl: BASE_URL, getApiKey });
    const voices =
      own && own.length > 0
        ? own
        : await listFishVoices({ baseUrl: BASE_URL, self: false, getApiKey });
    const referenceId = voices?.[0]?.id;

    const wav = await createTtsSynth({
      provider: "fish",
      baseUrl: BASE_URL,
      model: MODEL,
      ...(referenceId ? { voice: referenceId } : {}),
      getApiKey,
    })("Hello, can you hear me?");

    expect(wav.byteLength).toBeGreaterThan(1000);
    expect(isWav(wav), "RIFF/WAVE header expected").toBe(true);
  }, 60_000);
});
