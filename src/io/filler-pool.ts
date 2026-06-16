/**
 * TTFT filler pool resolution — pure helper shared by main.ts's getFiller/onThinkingStart.
 *
 * Effective pool for a language:
 *   - disabled → []
 *   - customPools[lang] when it has ≥1 entry, else config.filler.pools[lang] ?? []
 *
 * Both inputs are read live (current snapshots) by the caller so a hot-reload of
 * filler.json or a settings change takes effect on the next turn.
 */

import type { FillerConfig } from "../config/load";
import type { FillerSettings } from "./filler-settings";

export function effectiveFillerPool(settings: FillerSettings, config: FillerConfig): string[] {
  if (!settings.enabled) return [];
  const lang = settings.language;
  const custom = settings.customPools[lang];
  if (custom && custom.length > 0) return custom;
  return config.pools[lang] ?? [];
}
