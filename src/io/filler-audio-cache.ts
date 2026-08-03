/**
 * Session-scoped audio memo for filler phrases.
 *
 * Filler comes from a small fixed pool, so the same phrase is otherwise re-synthesized over the
 * network every turn. This wrapper keeps each pool phrase's audio in memory for the session,
 * keyed by text under the active TTS params — a params change drops the whole map and re-synthesizes.
 * Response sentences are unique per turn and pass straight through.
 *
 * decodeAudioData detaches the buffer it receives, so the cache stores a copy and hands out copies.
 */

import type { TtsSynth } from "./tts-synth";

export interface FillerAudioCacheDeps {
  synth: TtsSynth;
  /** Whether the text is a member of the current filler pool. */
  isFiller: (text: string) => boolean;
  /** The TTS params that affect the rendered audio, as one comparable string. */
  paramsKey: () => string;
}

export function createFillerAudioCache(deps: FillerAudioCacheDeps): TtsSynth {
  const audio = new Map<string, ArrayBuffer>();
  let currentKey: string | undefined;

  return async (input, signal) => {
    if (!deps.isFiller(input)) return deps.synth(input, signal);

    const key = deps.paramsKey();
    if (key !== currentKey) {
      audio.clear();
      currentKey = key;
    }

    const hit = audio.get(input);
    if (hit) return hit.slice(0);

    const wav = await deps.synth(input, signal);
    // The params may have changed while this was in flight — that audio no longer belongs here.
    if (currentKey === key) audio.set(input, wav.slice(0));
    return wav;
  };
}
