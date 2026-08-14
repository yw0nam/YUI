/**
 * TTFT filler pool resolution — pure helper shared by main.ts's filler wiring.
 *
 * Effective pool for a language resolves first/repeat independently:
 *   - disabled → { first: [], repeat: [] }
 *   - first = custom.first if ≥1 entry, else config.pools[lang]?.first ?? []
 *   - repeat = custom.repeat if ≥1 entry, else config.pools[lang]?.repeat ?? []
 *
 * Both inputs are read live (current snapshots) by the caller so a hot-reload of
 * filler.json or a settings change takes effect on the next turn.
 */

import type { FillerConfig, FillerPool } from "../config/load";
import type { FillerSettings } from "./filler-settings";
import { createSentenceSegmenter } from "./sentence-segmenter";
import { createEmojiStripper } from "./strip-emoji";

export function effectiveFillerPool(settings: FillerSettings, config: FillerConfig): FillerPool {
  if (!settings.enabled) return { first: [], repeat: [] };
  const lang = settings.language;
  const custom = settings.customPools[lang];
  const configPool = config.pools[lang];
  const first = custom && custom.first.length > 0 ? custom.first : (configPool?.first ?? []);
  const repeat = custom && custom.repeat.length > 0 ? custom.repeat : (configPool?.repeat ?? []);
  return { first, repeat };
}

/**
 * The sentences a pool phrase actually reaches TTS as: the speech path strips emoji and splits on
 * sentence boundaries before submitting, so a phrase carrying either never arrives as written.
 * Runs the production stripper and segmenter so the two stay in step.
 */
export function phraseSentences(phrase: string): string[] {
  const stripper = createEmojiStripper();
  const segmenter = createSentenceSegmenter();
  const sentences = segmenter.push(stripper.push(phrase) + stripper.flush());
  const rest = segmenter.flush();
  return rest ? [...sentences, rest] : sentences;
}

/** Every sentence the current pools can submit — the cacheable text of this turn. */
export function fillerSubmissions(pool: FillerPool): Set<string> {
  const submissions = new Set<string>();
  for (const phrase of [...pool.first, ...pool.repeat]) {
    for (const sentence of phraseSentences(phrase)) submissions.add(sentence);
  }
  return submissions;
}
