/**
 * Guardrails — debounce / rate-limit.
 *
 * Evaluation order: debounce → rate-limit. Dispatcher wiring order is
 * supersede → classify(tier) → evaluate(env, tier) → route. dnd_override short-circuits
 * at top of evaluate — user-initiated turns bypass all gates and don't increment any counter.
 *
 *  - Debounce: per source window. If now() − lastFire[source] < window, drop.
 *  - Rate-limit: per tier rolling window. Slots consumed on fire (=pass), no refund.
 *               If overall_max exceeded, set cooldownUntil (entry/exit transition owned by dispatcher).
 *
 * Evaluation functions are pure (return verdict only) — don't mutate dispatcher state, no dispatcher reference.
 * Time read only via injected now() (bare Date.now() forbidden).
 */

import type { GuardrailsConfig } from "../config/load";
import type { BusEnvelope } from "./event-bus";

export type { GuardrailsConfig };

/** Guardrail pass/drop judgment result. */
type GuardResult = { pass: true } | { pass: false; reason: "guardrail_drop"; detail: string };

export interface Guardrails {
  /** Evaluate one event in order. If pass=false, drop. Mutate debounce/rate state only if pass. */
  evaluate(env: BusEnvelope, tier: 1 | 2 | 3): GuardResult;
  /** Whether cooldown entered by overall-cap exceeding is still valid (now < cooldownUntil). */
  cooldownActive(): boolean;
  /** Hot reload: replace only config values (preserve runtime counter state). */
  setConfig(next: GuardrailsConfig): void;
}

type Source = BusEnvelope["source"];

interface CreateGuardrailsOptions {
  /** Time injection. default () => Date.now(). All windows/cooldowns read only this function. */
  now?: () => number;
}

export function createGuardrails(
  initialConfig: GuardrailsConfig,
  opts: CreateGuardrailsOptions = {},
): Guardrails {
  const now = opts.now ?? (() => Date.now());
  // Replaceable by hot reload — preserve runtime state (counters / cooldown).
  let config = initialConfig;

  // debounce: last pass time per source.
  const lastFire = new Map<Source, number>();

  // rate-limit: per tier + overall rolling window (pass times epoch ms).
  const tier2Window: number[] = [];
  const tier3Window: number[] = [];
  const overallWindow: number[] = [];
  let cooldownUntil = 0;

  /** Remove items from rolling window that are before now() − window_ms. */
  function prune(window: number[]): void {
    const cutoff = now() - config.rate_limit.window_ms;
    while (window.length > 0 && window[0] <= cutoff) window.shift();
  }

  function evaluate(env: BusEnvelope, tier: 1 | 2 | 3): GuardResult {
    // 1) dnd_override: top-level short-circuit. Don't increment any counter/debounce.
    if (env.dnd_override === true) return { pass: true };

    // 2) cooldown: if entered cooldown is still valid, drop.
    if (now() < cooldownUntil) {
      return { pass: false, reason: "guardrail_drop", detail: "cooldown" };
    }

    // 3) debounce: per source window. timer_scheduler is N/A (own 1x) → window 0 (no debounce).
    const window = (config.debounce_ms as Record<Source, number>)[env.source] ?? 0;
    const last = lastFire.get(env.source);
    if (window > 0 && last !== undefined && now() - last < window) {
      return { pass: false, reason: "guardrail_drop", detail: `debounce:${env.source}` };
    }

    // 4) rate-limit: prune tier window then cap, then overall cap.
    prune(tier2Window);
    prune(tier3Window);
    prune(overallWindow);
    if (tier === 2 && tier2Window.length >= config.rate_limit.tier2_max) {
      return { pass: false, reason: "guardrail_drop", detail: "rate_limit:tier2" };
    }
    if (tier === 3 && tier3Window.length >= config.rate_limit.tier3_max) {
      return { pass: false, reason: "guardrail_drop", detail: "rate_limit:tier3" };
    }
    if (overallWindow.length >= config.rate_limit.overall_max) {
      cooldownUntil = now() + config.rate_limit.cooldown_ms;
      return { pass: false, reason: "guardrail_drop", detail: "cooldown_entered" };
    }

    // 5) pass: consume slot at fire time (no refund).
    lastFire.set(env.source, now());
    if (tier === 2) tier2Window.push(now());
    if (tier === 3) tier3Window.push(now());
    overallWindow.push(now());
    return { pass: true };
  }

  return {
    evaluate,
    cooldownActive() {
      return now() < cooldownUntil;
    },
    setConfig(next) {
      config = next;
    },
  };
}
