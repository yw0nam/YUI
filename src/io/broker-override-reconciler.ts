/**
 * Reconciles endpoint overrides → the live Expression Broker client. The pet window's
 * config.subscribe path only reacts to disk-config edits; this seam reacts to the per-user
 * override store so a broker-URL change takes effect without a reload.
 *
 * onChange() compares the effective broker_base_url against the last-seen snapshot: a change
 * disposes the old client and creates+publishes+starts a new one at the new URL; an
 * empty/invalid URL disposes and leaves the broker disabled.
 *
 * Pure seam: every collaborator (broker factory, table loader, payload deriver, current-client
 * accessor) is injected. Best-effort — never throws on the UI path.
 */

import type { EndpointsConfig } from "../contract";
import { createLogger, type Logger } from "../logger";
import type { BrokerClient, BrokerPayload } from "./broker-client";
import { isValidEndpointUrl } from "./endpoints-settings";

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
  derivePayload: (eff: EndpointsConfig, table: Record<string, string> | null) => BrokerPayload;
  logger?: Logger;
}

export interface BrokerOverrideReconciler {
  /** Reflects a broker_base_url override change to the broker (URL retarget). */
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

  let lastBrokerUrl = brokerUrlOf(opts.getEffectiveEndpoints());

  async function republish(eff: EndpointsConfig, broker: BrokerClient): Promise<void> {
    const table = await opts.loadTable();
    await broker.publish(opts.derivePayload(eff, table));
  }

  async function onChange(): Promise<void> {
    try {
      const eff = opts.getEffectiveEndpoints();
      const url = brokerUrlOf(eff);
      if (url === lastBrokerUrl) return;

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
    } catch (err) {
      log.warn("reconcile_failed", { best_effort: true, error: String(err) });
    }
  }

  return { onChange };
}
