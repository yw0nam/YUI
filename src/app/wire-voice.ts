import { loadEmotionTextTable } from "../config/emotion-text";
import type { AppConfig, ConfigSection } from "../config/load";
import type { EndpointsConfig } from "../contract";
import {
  type BrokerClient,
  type BrokerPayload,
  createBrokerClient,
  deriveBrokerPayload,
} from "../io/chat/broker-client";
import { createBrokerOverrideReconciler } from "../io/chat/broker-override-reconciler";
import { selectFetch } from "../io/chat/chat-client";
import type { ExpressMotionSettings } from "../io/settings/express-motion-settings";
import type { SttVad } from "../io/voice/stt-vad";
import type { Logger } from "../logger";
import type { VoiceInputStatus } from "../ui/voice-input-status";

/**
 * Expression Broker publish (D6). Resolves the CORS-bypass fetch once, does the fire-and-forget
 * initial publish when broker_base_url is present (never blocks boot), and wires the override
 * reconciler so a live broker-URL edit retargets the client. `onConfigChange` is
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
  vocabulary: () => BrokerPayload;
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
  // Best-effort load of the emoji enum table; on failure the broker degrades to free mode.
  const loadBrokerTable = async (): Promise<Record<string, string> | null> => {
    try {
      table = await loadEmotionTextTable({ provider: "irodori" });
    } catch (err) {
      log.warn("emotion_text_load_failed", { fallback: "free", error: String(err) });
      table = null;
    }
    announce();
    return table;
  };
  /** Every payload goes through here, so the motion selection reaches publish and tools alike. */
  const derive = (
    cfg: AppConfig,
    eff: EndpointsConfig,
    emotionTable: Record<string, string> | null,
  ): BrokerPayload =>
    deriveBrokerPayload({ ...cfg, endpoints: eff }, emotionTable, {
      expressMotions: expressMotionSettings.get(),
    });
  const vocabulary = (): BrokerPayload => derive(getConfig(), getEndpoints(), table);

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
    if (!(changed.has("emotionRegistry") || changed.has("motions") || changed.has("endpoints"))) {
      return;
    }
    const eff = getEndpoints();
    // The table reload announces the change; the broker only hears about it when it is configured.
    void loadBrokerTable().then((loaded) => {
      if (broker) void broker.publish(derive(cfg, eff, loaded));
    });
  };

  const dispose = (): void => {
    unsubscribeOverride();
    unsubscribeExpressMotions();
    broker?.dispose();
  };

  return { onConfigChange, vocabulary, dispose };
}

/**
 * STT/VAD voice-input lifecycle: start/stop driven by the voiceInputStatus store, on/off intent
 * persisted to sttSettings for next-run auto-resume, and the STT engine bound post-config via setStt
 * (which also auto-resumes if voice was left on last session). The engine's submit/barge-in callbacks
 * are wired at the createSttVad call site, not here — this seam only owns the lifecycle.
 */
export function wireVoiceInput(deps: {
  voiceInputStatus: VoiceInputStatus;
  sttSettings: { get(): { enabled: boolean }; setEnabled(enabled: boolean): void };
}): {
  setStt: (stt: SttVad) => void;
  dispose: () => void;
} {
  const { voiceInputStatus, sttSettings } = deps;
  let sttVad: SttVad | null = null;
  let ready = false;
  let startRequested = false;

  async function startVoiceInput(): Promise<void> {
    startRequested = true;
    if (!ready || !sttVad) return;
    try {
      await sttVad.start();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Voice input failed";
      voiceInputStatus.set("error", detail);
    }
  }
  function stopVoiceInput(): void {
    startRequested = false;
    sttVad?.stop();
  }
  const unsubscribeStatus = voiceInputStatus.subscribe((snapshot) => {
    if (snapshot.state === "idle") {
      stopVoiceInput();
      return;
    }
    if (snapshot.state === "listening") {
      void startVoiceInput();
    }
  });
  // Persist voice input on/off intent — enabled if not idle. Used for auto-resume on next run.
  const unsubscribePersist = voiceInputStatus.subscribe((snapshot) => {
    sttSettings.setEnabled(snapshot.state !== "idle");
  });
  // Bind the STT engine once config is loaded; mark ready then auto-resume if left on last session.
  const setStt = (stt: SttVad): void => {
    sttVad = stt;
    ready = true;
    if (startRequested || voiceInputStatus.get().state !== "idle" || sttSettings.get().enabled) {
      void startVoiceInput();
    }
  };
  const dispose = (): void => {
    unsubscribeStatus();
    unsubscribePersist();
    void sttVad?.dispose();
  };
  return { setStt, dispose };
}
