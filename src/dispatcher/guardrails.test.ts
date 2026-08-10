/**
 * guardrails.test.ts — DND / debounce / rate-limit unit tests.
 *
 * Principle: time driven only by injected now() (no bare Date.now() dependency). Directly create
 * envelope composites from all sources (idle/timer/os/backend_push/user), locking evaluation branches.
 *
 * Sections locked:
 *  - §6.1 DND: toggle the manual trigger via note() / setDnd().
 *  - §6.2 Debounce: per-source window (idle 30s / os 5s / backend 10s / user 0).
 *  - §6.3 Rate-limit: tier2 6 / tier3 2 rolling 60min (N pass, N+1 drop, no refund),
 *    overall 20 → cooldownActive() true then 5min hold → release.
 *  - §6.4 Evaluation order + dnd_override short-circuit (no counter increment).
 */

import { describe, expect, it } from "vitest";
import type { BusEnvelope } from "./event-bus";
import { createGuardrails, type Guardrails, type GuardrailsConfig } from "./guardrails";

const BASE_TS = 1_717_000_000_000;

/** SOT configs/guardrails.json mirror (§6 values). */
function config(): GuardrailsConfig {
  return {
    debounce_ms: {
      idle_watcher: 30_000,
      os_event_watcher: 5_000,
      backend_push_source: 10_000,
      user_input_source: 0,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 6,
      tier3_max: 2,
      overall_max: 20,
      cooldown_ms: 300_000,
    },
  };
}

/** Injectable clock — test pushes .now to advance time. */
function clock(start = BASE_TS): {
  now: () => number;
  set: (t: number) => void;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    set: (v) => {
      t = v;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Composite envelope. Caller overrides source/event_name/payload. */
function env(over: Partial<BusEnvelope> = {}): BusEnvelope {
  return {
    source: "idle_watcher",
    event_name: "idle.long",
    ts: BASE_TS,
    ...over,
  };
}

// ── DND (§6.1) ──────────────────────────────────────────────────────────────────

describe("guardrails — DND (§6.1)", () => {
  it("user.dnd_toggle flips the manual reason", () => {
    const g = createGuardrails(config());
    g.note(env({ source: "user_input_source", event_name: "user.dnd_toggle" }));
    expect(g.dndState().on).toBe(true);
    expect(g.dndState().reasons).toContain("manual");
    g.note(env({ source: "user_input_source", event_name: "user.dnd_toggle" }));
    expect(g.dndState().on).toBe(false);
    expect(g.dndState().reasons).not.toContain("manual");
  });

  it("setDnd is the single source of truth (note is a thin translator over it)", () => {
    const g = createGuardrails(config());
    g.setDnd("manual", true);
    expect(g.dndState().reasons).toContain("manual");
    g.setDnd("manual", false);
    expect(g.dndState().on).toBe(false);
  });

  it("note no-ops gracefully on an unknown event_name", () => {
    const g = createGuardrails(config());
    expect(() =>
      g.note(env({ source: "os_event_watcher", event_name: "unknown.event" })),
    ).not.toThrow();
    expect(g.dndState().on).toBe(false);
  });
});

// ── evaluate: DND gate (§6.1 / §6.4) ─────────────────────────────────────────────

describe("guardrails — evaluate DND gate", () => {
  it("DND on → tier2/3 fail with detail dnd:<reasons>", () => {
    const g = createGuardrails(config());
    g.setDnd("manual", true);
    const r = g.evaluate(env(), 2);
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.reason).toBe("guardrail_drop");
      expect(r.detail).toContain("dnd:");
      expect(r.detail).toContain("manual");
    }
  });

  it("dnd_override bypasses DND and passes without mutating any counter", () => {
    const g = createGuardrails(config());
    g.setDnd("manual", true);
    // fire many user-override turns — DND on, debounce 0, none increments rate counters.
    for (let i = 0; i < 50; i++) {
      const r = g.evaluate(
        env({ source: "user_input_source", event_name: "user.text_submitted", dnd_override: true }),
        2,
      );
      expect(r.pass).toBe(true);
    }
    // overall counter never moved → cooldown not entered.
    expect(g.cooldownActive()).toBe(false);
  });
});

// ── Debounce (§6.2) ──────────────────────────────────────────────────────────────

describe("guardrails — debounce per source (§6.2)", () => {
  it("idle_watcher 30s window: 2nd within window drops, after window passes", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(g.evaluate(env({ source: "idle_watcher" }), 2).pass).toBe(true);

    c.advance(29_999);
    const r2 = g.evaluate(env({ source: "idle_watcher" }), 2);
    expect(r2.pass).toBe(false);
    if (!r2.pass) expect(r2.detail).toBe("debounce:idle_watcher");

    c.advance(1); // now exactly 30_000 since last fire
    expect(g.evaluate(env({ source: "idle_watcher" }), 2).pass).toBe(true);
  });

  it("os_event_watcher 5s window", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(
      g.evaluate(env({ source: "os_event_watcher", event_name: "user.drag_start" }), 3).pass,
    ).toBe(true);
    c.advance(4_999);
    expect(
      g.evaluate(env({ source: "os_event_watcher", event_name: "user.drag_start" }), 3).pass,
    ).toBe(false);
    c.advance(1);
    expect(
      g.evaluate(env({ source: "os_event_watcher", event_name: "user.drag_start" }), 3).pass,
    ).toBe(true);
  });

  it("backend_push_source 10s window", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(
      g.evaluate(env({ source: "backend_push_source", event_name: "backend.push.suggest" }), 3)
        .pass,
    ).toBe(true);
    c.advance(9_999);
    expect(
      g.evaluate(env({ source: "backend_push_source", event_name: "backend.push.suggest" }), 3)
        .pass,
    ).toBe(false);
    c.advance(1);
    expect(
      g.evaluate(env({ source: "backend_push_source", event_name: "backend.push.suggest" }), 3)
        .pass,
    ).toBe(true);
  });

  it("user_input_source 0 window — never debounce-dropped", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 3; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
      ).toBe(true);
    }
  });

  it("debounce state only mutates on a full pass (a dropped event does not move lastFire)", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(g.evaluate(env({ source: "idle_watcher" }), 2).pass).toBe(true); // lastFire = t0
    c.advance(10_000);
    expect(g.evaluate(env({ source: "idle_watcher" }), 2).pass).toBe(false); // dropped, lastFire stays t0
    c.advance(20_000); // t0 + 30_000 → window elapsed relative to t0, not the dropped attempt
    expect(g.evaluate(env({ source: "idle_watcher" }), 2).pass).toBe(true);
  });
});

// ── Rate-limit (§6.3) ────────────────────────────────────────────────────────────

describe("guardrails — rate-limit per tier rolling 60min (§6.3)", () => {
  it("tier2 cap 6: first 6 pass, 7th drops with detail rate_limit:tier2", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      // distinct sources/time to avoid debounce — drive via user_input (debounce 0).
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
      ).toBe(true);
    }
    const r = g.evaluate(
      env({ source: "user_input_source", event_name: "user.text_submitted" }),
      2,
    );
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.detail).toBe("rate_limit:tier2");
  });

  it("tier3 cap 2: 2 pass, 3rd drops with detail rate_limit:tier3", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 3).pass,
    ).toBe(true);
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 3).pass,
    ).toBe(true);
    const r = g.evaluate(
      env({ source: "user_input_source", event_name: "user.text_submitted" }),
      3,
    );
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.detail).toBe("rate_limit:tier3");
  });

  it("rolling window prunes: a tier2 slot frees once window_ms passes (no refund, time-based prune)", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
      ).toBe(true);
      c.advance(1);
    }
    // immediately full
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
    ).toBe(false);
    // advance past window relative to the first fire → one slot prunes, one more passes
    c.advance(3_600_000);
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
    ).toBe(true);
  });

  it("NO refund: a dropped (over-cap) attempt does not free a slot", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
      ).toBe(true);
    }
    // two over-cap attempts in the same instant — both drop, no slot is freed by the drops.
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
    ).toBe(false);
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
    ).toBe(false);
  });
});

describe("guardrails — overall cap → cooldown (§6.3)", () => {
  it("overall 20 → 21st enters cooldown; cooldownActive() true for 5min then clears", () => {
    const c = clock();
    const cfg = config();
    // raise tier caps so the overall cap is the binding constraint.
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: c.now });
    for (let i = 0; i < 20; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2).pass,
      ).toBe(true);
    }
    expect(g.cooldownActive()).toBe(false);

    const r = g.evaluate(
      env({ source: "user_input_source", event_name: "user.text_submitted" }),
      2,
    );
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.detail).toBe("cooldown_entered");
    expect(g.cooldownActive()).toBe(true);

    // still active just before 5min
    c.advance(299_999);
    expect(g.cooldownActive()).toBe(true);
    // clears at 5min
    c.advance(1);
    expect(g.cooldownActive()).toBe(false);
  });

  it("during cooldown, evaluate returns detail cooldown for further firings", () => {
    const c = clock();
    const cfg = config();
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: c.now });
    for (let i = 0; i < 20; i++) {
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2);
    }
    g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2); // enters cooldown
    const r = g.evaluate(
      env({ source: "user_input_source", event_name: "user.text_submitted" }),
      2,
    );
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.detail).toBe("cooldown");
  });
});

// ── Eval ordering (§6.4) ─────────────────────────────────────────────────────────

describe("guardrails — eval ordering (§6.4)", () => {
  it("dnd_override is checked first — bypasses DND, debounce, and rate-limit", () => {
    const g = createGuardrails(config());
    g.setDnd("manual", true); // DND on
    const r = g.evaluate(
      env({ source: "user_input_source", event_name: "user.text_submitted", dnd_override: true }),
      2,
    );
    expect(r.pass).toBe(true);
  });

  it("DND is checked before debounce — DND detail wins over a debounce-eligible repeat", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(g.evaluate(env({ source: "idle_watcher" }), 2).pass).toBe(true); // sets lastFire
    g.setDnd("manual", true); // DND on
    const r = g.evaluate(env({ source: "idle_watcher" }), 2); // would also debounce-fail
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.detail).toContain("dnd:");
  });

  it("cooldown is checked before debounce/rate — cooldown detail wins", () => {
    const c = clock();
    const cfg = config();
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: c.now });
    for (let i = 0; i < 21; i++) {
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }), 2);
    }
    expect(g.cooldownActive()).toBe(true);
    const r = g.evaluate(env({ source: "idle_watcher" }), 2);
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.detail).toBe("cooldown");
  });
});

// ── interface surface ────────────────────────────────────────────────────────────

describe("guardrails — interface surface", () => {
  it("exposes dndState / setDnd / note / evaluate / cooldownActive", () => {
    const g: Guardrails = createGuardrails(config());
    expect(typeof g.dndState).toBe("function");
    expect(typeof g.setDnd).toBe("function");
    expect(typeof g.note).toBe("function");
    expect(typeof g.evaluate).toBe("function");
    expect(typeof g.cooldownActive).toBe("function");
  });

  it("has NO refund method (consume-on-fire, §6.3)", () => {
    const g = createGuardrails(config()) as unknown as Record<string, unknown>;
    expect(g.refund).toBeUndefined();
  });
});
