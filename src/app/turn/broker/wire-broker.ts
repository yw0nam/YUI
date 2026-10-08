import { loadEmotionTextTable } from "../../../config/emotion-text";
import type { AppConfig, ConfigSection } from "../../../config/load";
import { ttsProviderOf } from "../../../config/tts-provider";
import type { EndpointsConfig, TtsProviderName } from "../../../contract";
import { type BrokerClient, createBrokerClient } from "../../../io/chat/broker/broker-client";
import { createBrokerOverrideReconciler } from "../../../io/chat/broker/broker-override-reconciler";
import { selectFetch } from "../../../io/chat/stream/chat-client";
import {
  deriveExpressVocabulary,
  type ExpressVocabulary,
} from "../../../io/chat/vocabulary/express-vocabulary";
import type { Logger } from "../../../logger";
import type { ExpressMotionSettings } from "../../../settings/avatar/express-motion-settings";

/**
 * Expression Broker publish (D6). Resolves the CORS-bypass fetch once, does the fire-and-forget
 * initial publish when broker_base_url is present (never blocks boot), and wires the override
 * reconciler so a live broker-URL edit retargets the client and a tts_provider edit reloads the vocabulary. `onConfigChange` is
 * called from the caller's config.subscribe to re-publish on disk edits that change renderable
 * vocab; effective (override-merged) endpoints are used so disk edits don't clobber user overrides.
 */
export async function wireBroker(deps: {
  getConfig: () => AppConfig;
  getEndpoints: () => EndpointsConfig;
  endpointsSettings: { subscribe(cb: () => void): () => void };
  /** Curates the published motion vocabulary; a change re-publishes it. */
  expressMotionSettings: {
    get(): ExpressMotionSettings;
    subscribe(cb: () => void): () => void;
  };
  /** Called whenever the renderable vocabulary may have moved, for consumers other than the broker. */
  onVocabularyChange?: () => void;
  log: Logger;
}): Promise<{
  onConfigChange: (cfg: AppConfig, changed: ReadonlySet<ConfigSection>) => void;
  /** Renderable vocabulary as published, for consumers that declare it themselves (CC client tools). */
  vocabulary: () => ExpressVocabulary;
  dispose: () => void;
}> {
  const { getConfig, getEndpoints, endpointsSettings, expressMotionSettings, log } = deps;
  // Announced from every site the vocabulary moves at, whether or not a broker is configured.
  const announce = (): void => deps.onVocabularyChange?.();
  // In the Tauri webview the broker (localhost:3201) is cross-origin → inject the CORS-bypass fetch.
  // Resolved once and reused when the client is retargeted.
  const brokerFetch = (await selectFetch()) ?? undefined;
  let broker: BrokerClient | null = null;
  const makeBroker = (baseUrl: string): BrokerClient =>
    createBrokerClient({ baseUrl, ...(brokerFetch ? { fetch: brokerFetch } : {}) });
  // Latest emotion_text table, kept current by every load so vocabulary() reflects it.
  let table: Record<string, string> | null = null;
  // The provider of the newest load; a load that settles after a newer one started is dropped.
  let tableProvider: TtsProviderName | undefined;
  let loads = 0;
  // Best-effort load of the emoji enum table, which only Irodori speaks; any other provider and a
  // failed load both leave the vocabulary in free mode.
  const loadBrokerTable = async (): Promise<Record<string, string> | null> => {
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
  /** Every payload goes through here, so the motion selection reaches publish and tools alike. */
  const derive = (
    cfg: AppConfig,
    eff: EndpointsConfig,
    emotionTable: Record<string, string> | null,
  ): ExpressVocabulary =>
    deriveExpressVocabulary({ ...cfg, endpoints: eff }, emotionTable, {
      expressMotions: expressMotionSettings.get(),
    });
  const vocabulary = (): ExpressVocabulary => derive(getConfig(), getEndpoints(), table);

  const bootEps = getEndpoints();
  // Loaded even with no broker: the vocabulary also feeds the client-declared tools.
  const bootTable = await loadBrokerTable();
  if (bootEps.broker_base_url) {
    broker = makeBroker(bootEps.broker_base_url);
    const payload = derive(getConfig(), bootEps, bootTable);
    void broker.publish(payload).then(() => broker?.start());
  } else {
    log.debug("broker_disabled", { reason: "no_broker_base_url" });
  }

  const reconciler = createBrokerOverrideReconciler({
    getEffectiveEndpoints: getEndpoints,
    getBroker: () => broker,
    setBroker: (b) => {
      broker = b;
    },
    createBroker: makeBroker,
    loadTable: loadBrokerTable,
    derivePayload: (eff, table) => derive(getConfig(), eff, table),
  });
  const unsubscribeOverride = endpointsSettings.subscribe(() => {
    void reconciler.onChange();
  });
  // The selection is broadcast-synced, so this fires for the settings window's edit too.
  const unsubscribeExpressMotions = expressMotionSettings.subscribe(() => {
    if (broker) void broker.publish(vocabulary());
    announce();
  });

  const onConfigChange = (cfg: AppConfig, changed: ReadonlySet<ConfigSection>): void => {
    // Of the endpoints, only the TTS provider moves the vocabulary.
    const vocabMoved =
      changed.has("emotionRegistry") ||
      changed.has("motions") ||
      (changed.has("endpoints") && ttsProviderOf(getEndpoints()) !== tableProvider);
    if (!vocabMoved) return;
    // The table reload announces the change; the broker only hears about it when it is configured.
    void loadBrokerTable().then((loaded) => {
      if (broker) void broker.publish(derive(cfg, getEndpoints(), loaded));
    });
  };

  const dispose = (): void => {
    unsubscribeOverride();
    unsubscribeExpressMotions();
    broker?.dispose();
  };

  return { onConfigChange, vocabulary, dispose };
}
