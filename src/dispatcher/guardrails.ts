/**
 * Guardrails — DND / debounce / rate-limit.
 *
 * Evaluation order: DND → debounce → rate-limit. Dispatcher wiring order is
 * supersede → classify(tier) → evaluate(env, tier) → route. dnd_override short-circuits
 * at top of evaluate — user-initiated turns bypass all gates and don't increment any counter.
 *
 *  - DND: If any of 4 triggers (Fullscreen / Camera / Active-app blocklist / Manual) is ON, DND_ON.
 *         note() is thin translator moving envelope → setDnd call (state owned by setDnd).
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

export type DndReason = "fullscreen" | "active_app" | "manual";

export interface DndState {
  on: boolean;
  reasons: DndReason[];
}

export type DropReason =
  | "guardrail_drop"
  | "parse_error"
  | "network_drop"
  | "http_4xx_drop"
  | "superseded_by_user";

/** Guardrail pass/drop judgment result. */
export type GuardResult = { pass: true } | { pass: false; reason: DropReason; detail: string };

export interface Guardrails {
  dndState(): DndState;
  /** DND trigger toggle (os.fullscreen_* / os.active_app_changed / user.dnd_toggle, etc.). */
  setDnd(reason: DndReason, on: boolean): void;
  /** Thin translator moving envelope → at most one setDnd call (update DND state). */
  note(env: BusEnvelope): void;
  /** Evaluate one event in order. If pass=false, drop. Mutate debounce/rate state only if pass. */
  evaluate(env: BusEnvelope, tier: 1 | 2 | 3): GuardResult;
  /** Whether cooldown entered by overall-cap exceeding is still valid (now < cooldownUntil). */
  cooldownActive(): boolean;
  /** Hot reload: replace only config values (preserve runtime DND/counter state). */
  setConfig(next: GuardrailsConfig): void;
}

type Source = BusEnvelope["source"];

export interface CreateGuardrailsOptions {
  /** Time injection. default () => Date.now(). All windows/cooldowns read only this function. */
  now?: () => number;
}

/** Return if payload[key] is non-empty string, else undefined. */
function strField(env: BusEnvelope, key: string): string | undefined {
  const v = env.payload?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function createGuardrails(
  initialConfig: GuardrailsConfig,
  opts: CreateGuardrailsOptions = {},
): Guardrails {
  const now = opts.now ?? (() => Date.now());
  // Replaceable by hot reload — preserve runtime state (DND reasons / counters / cooldown).
  let config = initialConfig;

  // Single source of DND state — only setDnd changes it.
  const dndReasons = new Set<DndReason>();

  // debounce: last pass time per source.
  const lastFire = new Map<Source, number>();

  // rate-limit: per tier + overall rolling window (pass times epoch ms).
  const tier2Window: number[] = [];
  const tier3Window: number[] = [];
  const overallWindow: number[] = [];
  let cooldownUntil = 0;

  function activeReasons(): DndReason[] {
    return [...dndReasons];
  }

  function setDnd(reason: DndReason, on: boolean): void {
    if (on) {
      dndReasons.add(reason);
    } else {
      dndReasons.delete(reason);
    }
  }

  function note(env: BusEnvelope): void {
    switch (env.event_name) {
      case "os.fullscreen_entered":
        setDnd("fullscreen", true);
        return;
      case "os.fullscreen_exited":
        setDnd("fullscreen", false);
        return;
      case "os.active_app_changed": {
        const app = strField(env, "active_app_name");
        if (app === undefined) return;
        setDnd("active_app", config.dnd.app_blocklist.includes(app));
        return;
      }
      case "user.dnd_toggle":
        setDnd("manual", !dndReasons.has("manual"));
        return;
      default:
        return;
    }
  }

  /** Remove items from rolling window that are before now() − window_ms. */
  function prune(window: number[]): void {
    const cutoff = now() - config.rate_limit.window_ms;
    while (window.length > 0 && window[0] <= cutoff) window.shift();
  }

  function evaluate(env: BusEnvelope, tier: 1 | 2 | 3): GuardResult {
    // 1) dnd_override: top-level short-circuit. Don't increment any counter/debounce.
    if (env.dnd_override === true) return { pass: true };

    // 2) DND: if any is on, drop.
    const reasons = activeReasons();
    if (reasons.length > 0) {
      return { pass: false, reason: "guardrail_drop", detail: `dnd:${reasons.join(",")}` };
    }

    // 3) cooldown: if entered cooldown is still valid, drop.
    if (now() < cooldownUntil) {
      return { pass: false, reason: "guardrail_drop", detail: "cooldown" };
    }

    // 4) debounce: per source window. timer_scheduler is N/A (own 1x) → window 0 (no debounce).
    const window = (config.debounce_ms as Record<Source, number>)[env.source] ?? 0;
    const last = lastFire.get(env.source);
    if (window > 0 && last !== undefined && now() - last < window) {
      return { pass: false, reason: "guardrail_drop", detail: `debounce:${env.source}` };
    }

    // 5) rate-limit: prune tier window then cap, then overall cap.
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

    // 6) pass: consume slot at fire time (no refund).
    lastFire.set(env.source, now());
    if (tier === 2) tier2Window.push(now());
    if (tier === 3) tier3Window.push(now());
    overallWindow.push(now());
    return { pass: true };
  }

  return {
    dndState() {
      const reasons = activeReasons();
      return { on: reasons.length > 0, reasons };
    },
    setDnd,
    note,
    evaluate,
    cooldownActive() {
      return now() < cooldownUntil;
    },
    setConfig(next) {
      config = next;
    },
  };
}
