/**
 * TTFT filler pool resolution — pure helper shared by main.ts's filler wiring.
 *
 * Effective pool for a language resolves each tier independently:
 *   - disabled → every tier empty
 *   - each list tier = custom tier if ≥1 entry, else config.pools[lang]'s tier
 *   - tool = custom.tool if it has ≥1 key, else config.pools[lang]?.tool
 *
 * Both inputs are read live (current snapshots) by the caller so a hot-reload of
 * filler.json or a settings change takes effect on the next turn.
 */

import type { FillerConfig, FillerPool } from "../config/load";
import type { FillerSettings } from "./filler-settings";
import { createSentenceSegmenter } from "./sentence-segmenter";
import { createEmojiStripper } from "./strip-emoji";

const EMPTY_POOL: FillerPool = {
  first: [],
  repeat: [],
  long_wait: [],
  tool: {},
  timeout: [],
  unreachable: [],
};

const LIST_TIERS = ["first", "repeat", "long_wait", "timeout", "unreachable"] as const;

export function effectiveFillerPool(settings: FillerSettings, config: FillerConfig): FillerPool {
  if (!settings.enabled) return { ...EMPTY_POOL };
  const lang = settings.language;
  const custom = settings.customPools[lang];
  const configPool = config.pools[lang];
  const out = { ...EMPTY_POOL };
  for (const tier of LIST_TIERS) {
    const customTier = custom?.[tier];
    out[tier] = customTier && customTier.length > 0 ? customTier : (configPool?.[tier] ?? []);
  }
  const customTool = custom?.tool;
  out.tool = customTool && Object.keys(customTool).length > 0 ? customTool : (configPool?.tool ?? {});
  return out;
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
  const phrases = [
    ...pool.first,
    ...pool.repeat,
    ...pool.long_wait,
    ...pool.timeout,
    ...pool.unreachable,
    ...Object.values(pool.tool).flat(),
  ];
  for (const phrase of phrases) {
    for (const sentence of phraseSentences(phrase)) submissions.add(sentence);
  }
  return submissions;
}
