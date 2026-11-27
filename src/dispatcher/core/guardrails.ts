/**
 * Guardrails — debounce / rate-limit, as three calls.
 *
 *  - arrive(env): dnd_override passes; otherwise the per-source debounce. If now() − lastFire[source]
 *    < window, the candidate drops; a pass stamps lastFire.
 *  - canSpend(env): whether the rolling window has a slot, without spending one. Urgent signals
 *    (urgent_signal_source) read rate_limit.urgent_max alone, outside the tier2 window, since an
 *    urgent turn asks to be handled now; everything else reads tier2_max.
 *  - spend(env): takes the slot once the turn is admitted. No refund. dnd_override spends nothing.
 *
 * Pure: no dispatcher reference. Time read only via injected now() (bare Date.now() forbidden).
 */

import type { GuardrailsConfig } from "../../config/validators/guardrails";
import type { BusEnvelope } from "./event-bus";

export type { GuardrailsConfig };

/** Guardrail pass/drop judgment result. */
type GuardResult = { pass: true } | { pass: false; reason: "guardrail_drop" };

export interface Guardrails {
  /** Debounce at arrival. A pass stamps the source's debounce. */
  arrive(env: BusEnvelope): GuardResult;
  /** Whether the envelope's rolling window has a free slot; spends nothing. */
  canSpend(env: BusEnvelope): boolean;
  /** Takes one slot of the envelope's window. */
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

  const isUrgent = (env: BusEnvelope): boolean => env.source === "urgent_signal_source";

  return {
    arrive(env) {
      if (env.dnd_override === true) return { pass: true };
      const window = (config.debounce_ms as Record<Source, number>)[env.source] ?? 0;
      const last = lastFire.get(env.source);
      if (window > 0 && last !== undefined && now() - last < window) {
        return { pass: false, reason: "guardrail_drop" };
      }
      lastFire.set(env.source, now());
      return { pass: true };
    },
    canSpend(env) {
      if (env.dnd_override === true) return true;
      const window = isUrgent(env) ? urgentWindow : tier2Window;
      prune(window);
      const max = isUrgent(env) ? config.rate_limit.urgent_max : config.rate_limit.tier2_max;
      return window.length < max;
    },
    spend(env) {
      if (env.dnd_override === true) return;
      (isUrgent(env) ? urgentWindow : tier2Window).push(now());
    },
    setConfig(next) {
      config = next;
    },
  };
}
