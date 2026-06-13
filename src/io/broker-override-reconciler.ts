/**
 * Reconciles endpoint overrides → the live Expression Broker client (#136). The pet window's
 * config.subscribe path only reacts to disk-config edits; this seam reacts to the per-user
 * override store so a voice-engine or broker-URL change takes effect without a reload.
 *
 * onChange() compares the effective endpoints against the last-seen snapshot:
 *   - tts_provider changed ⇒ re-publish vocab with the merged provider's table.
 *   - broker_base_url changed ⇒ dispose the old client and create+publish+start a new one at the
 *     new URL; an empty/invalid URL disposes and leaves the broker disabled.
 *
 * Pure seam: every collaborator (broker factory, table loader, payload deriver, current-client
 * accessor) is injected. Best-effort — never throws on the UI path (D4).
 */

import type { EndpointsConfig } from "../contract";
import { createLogger, type Logger } from "../logger";
import type { BrokerClient, BrokerPayload } from "./broker-client";
import { isValidEndpointUrl } from "./endpoints-settings";

export interface BrokerOverrideReconcilerOptions {
  /** 효과적(오버라이드 병합) 엔드포인트 — 호출 시점에 평가. */
  getEffectiveEndpoints: () => EndpointsConfig;
  getBroker: () => BrokerClient | null;
  setBroker: (b: BrokerClient | null) => void;
  /** 새 broker_base_url로 클라이언트 생성(CORS 우회 fetch는 주입부에서 바인딩). */
  createBroker: (baseUrl: string) => BrokerClient;
  /** provider별 emotion_text 테이블 로드(irodori만 enum, 그 외 null). */
  loadTable: (provider: string | undefined) => Promise<Record<string, string> | null>;
  /** 효과적 엔드포인트 + 테이블 → publish payload(merged provider를 반영). */
  derivePayload: (eff: EndpointsConfig, table: Record<string, string> | null) => BrokerPayload;
  logger?: Logger;
}

export interface BrokerOverrideReconciler {
  /** 오버라이드 변경 1회를 broker에 반영(provider 재발행 / URL 재지정). */
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

      // URL 변경이 우선 — 새 클라이언트가 생기면 그쪽으로 첫 발행을 싣는다.
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

      // URL 동일 + provider 변경 → 기존 클라이언트로 재발행(있을 때만).
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
