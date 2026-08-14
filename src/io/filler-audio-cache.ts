/**
 * Session-scoped audio memo for filler phrases.
 *
 * Filler comes from a small fixed pool, so the same phrase is otherwise re-synthesized over the
 * network every turn. This wrapper keeps each pool phrase's audio in memory for the session, keyed
 * by text: a TTS params change stales every entry and drops the whole map, while a pool edit only
 * evicts the sentences that left the pool. Response sentences are unique per turn and pass straight
 * through.
 *
 * decodeAudioData detaches the buffer it receives, so the cache stores a copy and hands out copies.
 */

import type { TtsSynth } from "./tts-synth";

export interface FillerAudioCacheDeps {
  synth: TtsSynth;
  /** The sentences the current filler pools submit to TTS — the cacheable text. */
  submissions: () => Set<string>;
  /** The TTS params that affect the rendered audio, as one comparable string. */
  paramsKey: () => string;
}

export interface FillerAudioCache {
  synth: TtsSynth;
  /** Whether this text can be spoken from the cache right now. Never synthesizes. */
  has: (text: string) => boolean;
}

export function createFillerAudioCache(deps: FillerAudioCacheDeps): FillerAudioCache {
  const audio = new Map<string, ArrayBuffer>();
  let currentKey: string | undefined;
  let currentSubmissions: string | undefined;

  // Drops whatever the current params and pool no longer cover, before any read of the map.
  function sync(): { key: string; submissions: Set<string> } {
    const key = deps.paramsKey();
    if (key !== currentKey) {
      audio.clear();
      currentKey = key;
    }
    const submissions = deps.submissions();
    const joined = [...submissions].join("\n");
    if (joined !== currentSubmissions) {
      currentSubmissions = joined;
      for (const text of audio.keys()) {
        if (!submissions.has(text)) audio.delete(text);
      }
    }
    return { key, submissions };
  }

  return {
    synth: async (input, signal) => {
      const { key, submissions } = sync();
      if (!submissions.has(input)) return deps.synth(input, signal);

      const hit = audio.get(input);
      if (hit) return hit.slice(0);

      const wav = await deps.synth(input, signal);
      // The params or the pool may have moved on while this was in flight — audio for a phrase that
      // is now stale or gone no longer belongs here, and no later prune would catch it.
      const settled = sync();
      if (settled.key === key && settled.submissions.has(input)) audio.set(input, wav.slice(0));
      return wav;
    },

    has(text) {
      sync();
      return audio.has(text);
    },
  };
}
