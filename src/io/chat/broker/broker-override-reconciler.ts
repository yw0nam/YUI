/**
 * Reconciles endpoint overrides → the live Expression Broker client. The pet window's
 * config.subscribe path only reacts to disk-config edits; this seam reacts to the per-user
 * override store so a broker-URL change takes effect without a reload.
 *
 * onChange() compares the effective broker_base_url against the last-seen snapshot: a change
 * disposes the old client and creates+publishes+starts a new one at the new URL; an
 * empty/invalid URL disposes and leaves the broker disabled. A tts_provider change under the same
 * URL reloads the emotion_text table (which announces it) and republishes to the current client.
 *
 * Pure seam: every collaborator (broker factory, table loader, payload deriver, current-client
 * accessor) is injected. Best-effort — never throws on the UI path.
 */

import { ttsProviderOf } from "../../../config/tts-provider";
import type { EndpointsConfig } from "../../../contract";
import { createLogger, type Logger } from "../../../logger";
import { isValidEndpointUrl } from "../../../settings/backend/endpoints-settings";
import type { ExpressVocabulary } from "../vocabulary/express-vocabulary";
import type { BrokerClient } from "./broker-client";

interface BrokerOverrideReconcilerOptions {
  /** Effective (override-merged) endpoints — evaluated at call time. */
  getEffectiveEndpoints: () => EndpointsConfig;
  getBroker: () => BrokerClient | null;
  setBroker: (b: BrokerClient | null) => void;
  /** Creates a client for a new broker_base_url (the CORS-bypassing fetch is bound at the injection site). */
  createBroker: (baseUrl: string) => BrokerClient;
  /** Loads the emoji emotion_text table (null when unavailable). */
  loadTable: () => Promise<Record<string, string> | null>;
  /** Effective endpoints + table → publish payload. */
  derivePayload: (eff: EndpointsConfig, table: Record<string, string> | null) => ExpressVocabulary;
  logger?: Logger;
}

interface BrokerOverrideReconciler {
  /** Reflects a broker_base_url change (URL retarget) or a tts_provider change (vocabulary reload). */
  onChange: () => Promise<void>;
}

function brokerUrlOf(eff: EndpointsConfig): string {
  const u = (eff.broker_base_url ?? "").trim();
  return u !== "" && isValidEndpointUrl(u) ? u : "";
}

export function createBrokerOverrideReconciler(
  opts: BrokerOverrideReconcilerOptions,
): BrokerOverrideReconciler {
  const log = opts.logger ?? createLogger("broker-reconciler");

  const initial = opts.getEffectiveEndpoints();
  let lastBrokerUrl = brokerUrlOf(initial);
  let lastProvider = ttsProviderOf(initial);

  // Publishes against the endpoints live once the table load settles, never a stale snapshot.
  async function republish(broker: BrokerClient | null): Promise<void> {
    const table = await opts.loadTable();
    await broker?.publish(opts.derivePayload(opts.getEffectiveEndpoints(), table));
  }

  async function onChange(): Promise<void> {
    try {
      const eff = opts.getEffectiveEndpoints();
      const url = brokerUrlOf(eff);
      const provider = ttsProviderOf(eff);
      const providerChanged = provider !== lastProvider;
      lastProvider = provider;
      if (url === lastBrokerUrl) {
        if (providerChanged) await republish(opts.getBroker());
        return;
      }

      const old = opts.getBroker();
      old?.dispose();
      if (url === "") {
        opts.setBroker(null);
        // The reload still announces the provider's vocabulary to the consumers other than the broker.
        if (providerChanged) await opts.loadTable();
      } else {
        const next = opts.createBroker(url);
        opts.setBroker(next);
        await republish(next);
        next.start();
      }
      lastBrokerUrl = url;
    } catch (err) {
      log.warn("reconcile_failed", { best_effort: true, error: String(err) });
    }
  }

  return { onChange };
}
