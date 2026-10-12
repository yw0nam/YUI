import { loadEmotionTextTable } from "../../../config/emotion-text";
import type { AppConfig, ConfigSection } from "../../../config/load";
import { ttsProviderOf } from "../../../config/tts-provider";
import type { EndpointsConfig, TtsProviderName } from "../../../contract";
import {
  deriveExpressVocabulary,
  type ExpressVocabulary,
} from "../../../io/chat/vocabulary/express-vocabulary";
import type { Logger } from "../../../logger";
import type { ExpressMotionSettings } from "../../../settings/avatar/express-motion-settings";

export interface VocabularyWiring {
  /** The renderable vocabulary from the live config, the motion selection, and the loaded emotion_text table. */
  vocabulary: () => ExpressVocabulary;
  /** Reloads the emotion_text table for the live provider and announces; resolves the newest load's table. */
  reloadTable: () => Promise<Record<string, string> | null>;
  /** Reloads the table when a config change moved the vocabulary. */
  onConfigChange: (cfg: AppConfig, changed: ReadonlySet<ConfigSection>) => void;
  /** Called whenever the vocabulary may have moved. */
  subscribe: (cb: () => void) => () => void;
  dispose: () => void;
}

/**
 * Owns the vocabulary every consumer declares: the client-declared tool schema, the push socket,
 * and the broker publish. Effective (override-merged) endpoints pick the TTS provider, so disk
 * edits don't clobber user overrides.
 */
export async function wireVocabulary(deps: {
  getConfig: () => AppConfig;
  getEndpoints: () => EndpointsConfig;
  /** Curates the motion vocabulary; a change is announced. */
  expressMotionSettings: {
    get(): ExpressMotionSettings;
    subscribe(cb: () => void): () => void;
  };
  log: Logger;
}): Promise<VocabularyWiring> {
  const { getConfig, getEndpoints, expressMotionSettings, log } = deps;
  const listeners = new Set<() => void>();
  const announce = (): void => {
    for (const cb of [...listeners]) cb();
  };
  // Latest emotion_text table, kept current by every load so vocabulary() reflects it.
  let table: Record<string, string> | null = null;
  // The provider of the newest load; a load that settles after a newer one started is dropped.
  let tableProvider: TtsProviderName | undefined;
  let loads = 0;
  // Best-effort load of the emoji enum table, which only Irodori speaks; any other provider and a
  // failed load both leave the vocabulary in free mode.
  const reloadTable = async (): Promise<Record<string, string> | null> => {
    const mine = ++loads;
    tableProvider = ttsProviderOf(getEndpoints());
    let next: Record<string, string> | null = null;
    try {
      if (tableProvider === "irodori") next = await loadEmotionTextTable({ provider: "irodori" });
    } catch (err) {
      log.warn("emotion_text_load_failed", { fallback: "free", error: String(err) });
    }
    if (mine !== loads) return table;
    table = next;
    announce();
    return table;
  };
  const vocabulary = (): ExpressVocabulary =>
    deriveExpressVocabulary({ ...getConfig(), endpoints: getEndpoints() }, table, {
      expressMotions: expressMotionSettings.get(),
    });

  await reloadTable();
  // The selection is broadcast-synced, so this fires for the settings window's edit too.
  const unsubscribeExpressMotions = expressMotionSettings.subscribe(announce);

  const onConfigChange = (_cfg: AppConfig, changed: ReadonlySet<ConfigSection>): void => {
    // Of the endpoints, only the TTS provider moves the vocabulary.
    const vocabMoved =
      changed.has("emotionRegistry") ||
      changed.has("motions") ||
      (changed.has("endpoints") && ttsProviderOf(getEndpoints()) !== tableProvider);
    if (vocabMoved) void reloadTable();
  };

  return {
    vocabulary,
    reloadTable,
    onConfigChange,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose: unsubscribeExpressMotions,
  };
}
