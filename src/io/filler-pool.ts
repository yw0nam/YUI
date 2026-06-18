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

export function effectiveFillerPool(settings: FillerSettings, config: FillerConfig): FillerPool {
  if (!settings.enabled) return { first: [], repeat: [] };
  const lang = settings.language;
  const custom = settings.customPools[lang];
  const configPool = config.pools[lang];
  const first = custom && custom.first.length > 0 ? custom.first : (configPool?.first ?? []);
  const repeat = custom && custom.repeat.length > 0 ? custom.repeat : (configPool?.repeat ?? []);
  return { first, repeat };
}
