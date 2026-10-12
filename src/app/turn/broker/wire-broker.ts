// Deprecated: removed in v0.6.0. Use client-declared tools (src/io/chat/stream/client-tools.ts).
import type { EndpointsConfig } from "../../../contract";
import { type BrokerClient, createBrokerClient } from "../../../io/chat/broker/broker-client";
import { createBrokerOverrideReconciler } from "../../../io/chat/broker/broker-override-reconciler";
import { selectFetch } from "../../../io/chat/stream/chat-client";
import type { Logger } from "../../../logger";
import type { VocabularyWiring } from "../vocabulary/wire-vocabulary";

/**
 * Expression Broker publish (D6). Resolves the CORS-bypass fetch once, does the fire-and-forget
 * initial publish when broker_base_url is present (never blocks boot), and wires the override
 * reconciler so a live broker-URL edit retargets the client and a tts_provider edit reloads the
 * vocabulary. Every later move of the vocabulary republishes it.
 */
export async function wireBroker(deps: {
  getEndpoints: () => EndpointsConfig;
  endpointsSettings: { subscribe(cb: () => void): () => void };
  vocabulary: Pick<VocabularyWiring, "vocabulary" | "reloadTable" | "subscribe">;
  log: Logger;
}): Promise<{ dispose: () => void }> {
  const { getEndpoints, endpointsSettings, vocabulary, log } = deps;
  // In the Tauri webview the broker (localhost:3201) is cross-origin → inject the CORS-bypass fetch.
  // Resolved once and reused when the client is retargeted.
  const brokerFetch = (await selectFetch()) ?? undefined;
  let broker: BrokerClient | null = null;
  let warnedDeprecated = false;
  const makeBroker = (baseUrl: string): BrokerClient => {
    if (!warnedDeprecated) {
      warnedDeprecated = true;
      log.warn("deprecated", {
        what: "broker_base_url",
        removed_in: "v0.6.0",
        use: "client-declared tools",
      });
    }
    return createBrokerClient({ baseUrl, ...(brokerFetch ? { fetch: brokerFetch } : {}) });
  };

  const bootEps = getEndpoints();
  if (bootEps.broker_base_url) {
    broker = makeBroker(bootEps.broker_base_url);
    void broker.publish(vocabulary.vocabulary()).then(() => broker?.start());
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
    loadTable: vocabulary.reloadTable,
    derivePayload: () => vocabulary.vocabulary(),
  });
  const unsubscribeOverride = endpointsSettings.subscribe(() => {
    void reconciler.onChange();
  });
  const unsubscribeVocabulary = vocabulary.subscribe(() => {
    if (broker) void broker.publish(vocabulary.vocabulary());
  });

  return {
    dispose: () => {
      unsubscribeOverride();
      unsubscribeVocabulary();
      broker?.dispose();
    },
  };
}
