/**
 * Reconciles endpoint overrides → the live Expression Broker client. The pet window's
 * config.subscribe path only reacts to disk-config edits; this seam reacts to the per-user
 * override store so a voice-engine or broker-URL change takes effect without a reload.
 *
 * onChange() compares the effective endpoints against the last-seen snapshot:
 *   - tts_provider changed ⇒ re-publish vocab with the merged provider's table.
 *   - broker_base_url changed ⇒ dispose the old client and create+publish+start a new one at the
 *     new URL; an empty/invalid URL disposes and leaves the broker disabled.
 *
 * Pure seam: every collaborator (broker factory, table loader, payload deriver, current-client
 * accessor) is injected. Best-effort — never throws on the UI path.
 */

import type { EndpointsConfig } from "../contract";
import { createLogger, type Logger } from "../logger";
import type { BrokerClient, BrokerPayload } from "./broker-client";
import { isValidEndpointUrl } from "./endpoints-settings";

export interface BrokerOverrideReconcilerOptions {
  /** Effective (override-merged) endpoints — evaluated at call time. */
  getEffectiveEndpoints: () => EndpointsConfig;
  getBroker: () => BrokerClient | null;
  setBroker: (b: BrokerClient | null) => void;
  /** Creates a client for a new broker_base_url (the CORS-bypassing fetch is bound at the injection site). */
  createBroker: (baseUrl: string) => BrokerClient;
  /** Loads the per-provider emotion_text table (enum only for irodori, null otherwise). */
  loadTable: (provider: string | undefined) => Promise<Record<string, string> | null>;
  /** Effective endpoints + table → publish payload (reflecting the merged provider). */
  derivePayload: (eff: EndpointsConfig, table: Record<string, string> | null) => BrokerPayload;
  logger?: Logger;
}

export interface BrokerOverrideReconciler {
  /** Reflects a single override change to the broker (provider re-publish / URL retarget). */
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
  let lastProvider = initial.tts_provider;
  let lastBrokerUrl = brokerUrlOf(initial);

  async function republish(eff: EndpointsConfig, broker: BrokerClient): Promise<void> {
    const table = await opts.loadTable(eff.tts_provider);
    await broker.publish(opts.derivePayload(eff, table));
  }

  async function onChange(): Promise<void> {
    try {
      const eff = opts.getEffectiveEndpoints();
      const provider = eff.tts_provider;
      const url = brokerUrlOf(eff);

      // URL change takes priority — when a new client is created, the first publish rides on it.
      if (url !== lastBrokerUrl) {
        const old = opts.getBroker();
        old?.dispose();
        if (url === "") {
          opts.setBroker(null);
        } else {
          const next = opts.createBroker(url);
          opts.setBroker(next);
          await republish(eff, next);
          next.start();
        }
        lastBrokerUrl = url;
        lastProvider = provider;
        return;
      }

      // Same URL + provider change → re-publish on the existing client (only if present).
      if (provider !== lastProvider) {
        lastProvider = provider;
        const broker = opts.getBroker();
        if (broker) await republish(eff, broker);
      }
    } catch (err) {
      log.warn("reconcile_failed", { best_effort: true, error: String(err) });
    }
  }

  return { onChange };
}
