/**
 * Guardrails — debounce / rate-limit.
 *
 * Evaluation order: dnd_override → urgent cap → debounce → rate-limit. Dispatcher wiring order is
 * supersede → classify → evaluate(env) → route, for tier 2 only. dnd_override short-circuits
 * at top of evaluate — user-initiated turns bypass all gates and don't increment any counter.
 *
 *  - Debounce: per source window. If now() − lastFire[source] < window, drop.
 *  - Rate-limit: tier-2 rolling window capped by tier2_max. Slots consumed on fire (=pass), no refund.
 *  - Urgent signals (urgent_signal_source): capped by rate_limit.urgent_max alone — outside
 *               the tier2 window, since an urgent turn asks to be handled now.
 *
 * Evaluation functions are pure (return verdict only) — don't mutate dispatcher state, no dispatcher reference.
 * Time read only via injected now() (bare Date.now() forbidden).
 */

import type { GuardrailsConfig } from "../../config/validators/guardrails";
import type { BusEnvelope } from "./event-bus";

export type { GuardrailsConfig };

/** Guardrail pass/drop judgment result. */
type GuardResult = { pass: true } | { pass: false; reason: "guardrail_drop" };

export interface Guardrails {
  /** Evaluate one event in order. If pass=false, drop. Mutate debounce/rate state only if pass. */
  evaluate(env: BusEnvelope): GuardResult;
  arrive(env: BusEnvelope): GuardResult;
  canSpend(env: BusEnvelope): boolean;
  spend(env: BusEnvelope): void;
  /** Hot reload: replace only config values (preserve runtime counter state). */
  setConfig(next: GuardrailsConfig): void;
}

type Source = BusEnvelope["source"];

interface CreateGuardrailsOptions {
  /** Time injection. default () => Date.now(). All windows read only this function. */
  now?: () => number;
}

export function createGuardrails(
  initialConfig: GuardrailsConfig,
  opts: CreateGuardrailsOptions = {},
): Guardrails {
  const now = opts.now ?? (() => Date.now());
  // Replaceable by hot reload — preserve runtime state (counters).
  let config = initialConfig;

  // debounce: last pass time per source.
  const lastFire = new Map<Source, number>();

  // rate-limit: tier 2 + urgent rolling windows (pass times epoch ms).
  const tier2Window: number[] = [];
  const urgentWindow: number[] = [];

  /** Remove items from rolling window that are before now() − window_ms. */
  function prune(window: number[]): void {
    const cutoff = now() - config.rate_limit.window_ms;
    while (window.length > 0 && window[0] <= cutoff) window.shift();
  }

  function evaluate(env: BusEnvelope): GuardResult {
    // 1) dnd_override: top-level short-circuit. Don't increment any counter/debounce.
    if (env.dnd_override === true) return { pass: true };

    // 2) urgent signals: urgent_max is their only cap — they consume no tier2 slot.
    if (env.source === "urgent_signal_source") {
      prune(urgentWindow);
      if (urgentWindow.length >= config.rate_limit.urgent_max) {
        return { pass: false, reason: "guardrail_drop" };
      }
      urgentWindow.push(now());
      return { pass: true };
    }

    // 3) debounce: per source window. timer_scheduler is N/A (own 1x) → window 0 (no debounce).
    const window = (config.debounce_ms as Record<Source, number>)[env.source] ?? 0;
    const last = lastFire.get(env.source);
    if (window > 0 && last !== undefined && now() - last < window) {
      return { pass: false, reason: "guardrail_drop" };
    }

    // 4) rate-limit: prune tier window then cap.
    prune(tier2Window);
    if (tier2Window.length >= config.rate_limit.tier2_max) {
      return { pass: false, reason: "guardrail_drop" };
    }

    // 5) pass: consume slot at fire time (no refund).
    lastFire.set(env.source, now());
    tier2Window.push(now());
    return { pass: true };
  }

  return {
    evaluate,
    // Test-commit stubs, replaced in the implementation commit.
    arrive: () => ({ pass: true }),
    canSpend: () => true,
    spend: () => {},
    setConfig(next) {
      config = next;
    },
  };
}
